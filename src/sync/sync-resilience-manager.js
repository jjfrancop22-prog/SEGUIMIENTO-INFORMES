import {eventBus} from '../core/event-bus.js';
import {outboxRepository} from '../data/outbox-repository.js';
import {auditRepository} from '../data/audit-repository.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {canReadCloudDomain} from '../security/cloud-domain-access.js';

const DOMAINS=['SAMPLES','LABORATORY','REPORTS','BILLING','RECEIVABLES','CLIENTS','CATALOGS'];
const now=()=>new Date().toISOString();

export class SyncResilienceManager{
  constructor(syncManager,{liveController=null,onRecovered=async()=>{}}={}){
    this.manager=syncManager;
    this.adapter=syncManager.adapter;
    this.liveController=liveController;
    this.onRecovered=onRecovered;
    this.started=false;
    this.retryTimer=null;
    this.retryAttempt=0;
    this.recovering=false;
    this.boundOnline=()=>this.recover('BROWSER_ONLINE').catch(()=>{});
    this.boundOffline=()=>this.handleOffline();
  }
  async init(){
    if(this.started)return this.status();
    this.started=true;
    window.addEventListener('online',this.boundOnline);
    window.addEventListener('offline',this.boundOffline);
    eventBus.on('sync:ack',e=>this.recordAck(e.detail).catch(()=>{}));
    eventBus.on('sync:error',e=>this.scheduleRetry(e.detail?.domain||'SYSTEM'));
    eventBus.on('outbox:changed',()=>this.checkPending().catch(()=>{}));
    if(navigator.onLine)await this.checkPending();
    return this.status();
  }
  stop(){
    window.removeEventListener('online',this.boundOnline);
    window.removeEventListener('offline',this.boundOffline);
    if(this.retryTimer)clearTimeout(this.retryTimer);
    this.retryTimer=null;this.started=false;
  }
  async recordAck(detail={}){
    const domain=String(detail.domain||'SYSTEM').toUpperCase();
    const row=detail.row||{};
    const at=now();
    await syncStateRepository.patch(domain,{lastAckAt:at,lastSuccessAt:at,lastError:null});
    await auditRepository.record({
      action:'SYNC_ACK',domain,entityId:row.entityId||'',entityType:row.entityType||'',userId:'SYNC_ENGINE',
      metadata:{outboxId:row.id||null,revision:row.revision??null,result:detail.result||null,superseded:!!detail.superseded,ackedAt:at}
    });
  }
  handleOffline(){
    if(this.retryTimer)clearTimeout(this.retryTimer);
    this.retryTimer=null;
    for(const domain of DOMAINS)syncStateRepository.patch(domain,{status:'LOCAL_ONLY',lastError:null}).catch(()=>{});
  }
  scheduleRetry(domain='SYSTEM'){
    if(!this.started||!navigator.onLine||this.retryTimer)return;
    const wait=Math.min(60000,Math.max(1500,1500*(2**Math.min(this.retryAttempt,5))));
    this.retryAttempt++;
    this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.recover(`AUTO_RETRY:${domain}`).catch(()=>this.scheduleRetry(domain))},wait);
  }
  async checkPending(){
    const pending=await outboxRepository.pending();
    if(pending.length&&navigator.onLine)this.scheduleRetry('OUTBOX_PENDING');
    return pending.length;
  }
  async recover(reason='MANUAL'){
    if(this.recovering)return {busy:true};
    this.recovering=true;
    try{
      let health=await this.adapter.health();
      if(!health.connected&&health.configured&&typeof this.adapter.restoreConnection==='function')health=await this.adapter.restoreConnection();
      if(!health.connected)return {connected:false,reason};
      const results=[];
      for(const domain of DOMAINS.filter(canReadCloudDomain)){
        try{
          if(this.liveController?.domains?.get(domain)?.active!==true){
            await this.liveController?.activateDomain?.(domain,{manual:false});
          }
          const runtime=this.manager.domain(domain);
          const pushed=await runtime.processPending({allowDeletes:true});
          const pulled=await runtime.pull();
          results.push({domain,ok:true,pushed,pulled});
        }catch(error){
          results.push({domain,ok:false,error:String(error?.message||error)});
        }
      }
      const failed=results.filter(x=>!x.ok);
      if(failed.length){this.scheduleRetry(failed[0].domain);return {connected:true,recovered:false,reason,results}}
      this.retryAttempt=0;
      if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=null;
      await auditRepository.record({action:'SYNC_RECOVERY_COMPLETE',domain:'SYSTEM',userId:'SYNC_ENGINE',metadata:{reason,domains:results.map(x=>x.domain),recoveredAt:now()}});
      await this.onRecovered({reason,results});
      return {connected:true,recovered:true,reason,results};
    }finally{this.recovering=false}
  }
  async status(){
    const [health,pending,states]=await Promise.all([this.adapter.health(),outboxRepository.pending(),syncStateRepository.all()]);
    const allowed=DOMAINS.filter(canReadCloudDomain);
    const stateMap=new Map(states.map(x=>[String(x.domain||'').toUpperCase(),x]));
    const domains=allowed.map(domain=>({domain,live:!!this.liveController?.domains?.get(domain)?.active,pending:pending.filter(x=>String(x.domain||'').toUpperCase()===domain).length,lastAckAt:stateMap.get(domain)?.lastAckAt||null,lastError:stateMap.get(domain)?.lastError||null}));
    return {started:this.started,online:navigator.onLine,connected:!!health.connected,retryAttempt:this.retryAttempt,recovering:this.recovering,domains,allSynchronized:!!health.connected&&domains.every(x=>x.live&&x.pending===0&&!x.lastError)};
  }
}
