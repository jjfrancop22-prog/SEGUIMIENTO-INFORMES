import {getAll,clearStore,putManyDirect,put} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {SYNC_DOMAINS,SYNC_STATUS} from '../sync/sync-constants.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {auditRepository} from '../data/audit-repository.js';
import {getDeviceId} from '../core/device.js';
import {VERSION_METADATA} from '../core/version-metadata.js';
import {canReadCloudDomain} from '../security/cloud-domain-access.js';

const BOOTSTRAP_STATE_ID='cloudBootstrap:active';
const nowIso=()=>new Date().toISOString();

export class InitialCloudBootstrapService{
  constructor(adapter){this.adapter=adapter}
  async localCounts(){const out={};for(const d of SYNC_DOMAINS)out[d.id]=(await getAll(STORES[d.store])).length;return out}
  async status(){const rows=await getAll(STORES.meta);return rows.find(x=>x.id===BOOTSTRAP_STATE_ID)||{id:BOOTSTRAP_STATE_ID,status:'NOT_STARTED'}}
  async ensureConnected(){let h=await this.adapter.health();if(!h.connected&&h.configured&&typeof this.adapter.restoreConnection==='function'){await this.adapter.restoreConnection();h=await this.adapter.health()}if(!h.connected){if(!h.configured)throw new Error('Firebase no está configurado.');await this.adapter.connect();h=await this.adapter.health()}if(!h.connected)throw new Error('No fue posible conectar Firebase para Bootstrap.');return h}
  async preflight(){
    const health=await this.ensureConnected();
    const manifest=await this.adapter.getSeedManifest?.();
    if(!manifest||manifest.status!=='COMPLETE')throw new Error('Firebase no contiene un Initial Cloud Seed COMPLETE. No se puede hacer Bootstrap.');
    const outbox=await getAll(STORES.outbox),pending=outbox.filter(x=>x.status!=='SENT').length;
    if(pending)throw new Error(`Esta PC tiene ${pending} cambio(s) local(es) pendientes. Bootstrap se bloquea para no sobrescribirlos.`);
    const localCounts=await this.localCounts(),remoteCounts={};
    const allowedDomains=SYNC_DOMAINS.filter(d=>canReadCloudDomain(d.id));
    if(!allowedDomains.length)throw new Error('El rol autenticado no tiene dominios autorizados para Bootstrap.');
    for(const d of allowedDomains)remoteCounts[d.id]=await this.adapter.countEntities(d.id);
    const remoteTotal=Object.values(remoteCounts).reduce((a,b)=>a+Number(b||0),0);
    if(!remoteTotal)throw new Error('Firebase está vacío. Esta instalación debe usar Initial Cloud Seed, no Bootstrap.');
    return {ok:true,health,manifest,localCounts,remoteCounts,remoteTotal,allowedDomains:allowedDomains.map(d=>d.id),localTotal:Object.values(localCounts).reduce((a,b)=>a+Number(b||0),0)};
  }
  async downloadDomain(domain,{batchSize=250,onProgress=()=>{}}={}){
    const expected=await this.adapter.countEntities(domain),rows=[];let afterId=null,done=0;
    while(true){
      const page=await this.adapter.fetchDomainPage(domain,{afterId,limitCount:batchSize});
      rows.push(...page.rows);done+=page.rows.length;afterId=page.nextId;
      onProgress({phase:'DOWNLOAD_BATCH',domain,done,total:expected,batchSize:page.rows.length});
      if(!page.hasMore||!page.rows.length)break;
    }
    if(rows.length!==expected)throw new Error(`${domain}: descargados ${rows.length}, esperados ${expected}. No se modificó el store local.`);
    return rows;
  }
  async run({batchSize=250,onProgress=()=>{}}={}){
    const pf=await this.preflight(),startedAt=nowIso();
    const state={id:BOOTSTRAP_STATE_ID,type:'INITIAL_CLOUD_BOOTSTRAP',status:'DOWNLOADING',startedAt,updatedAt:startedAt,projectId:pf.health.projectId,namespace:pf.health.namespace,deviceId:getDeviceId(),remoteCounts:pf.remoteCounts,domains:{}};
    await put(STORES.meta,state);
    const downloaded={};let globalDone=0,globalTotal=pf.remoteTotal;
    try{
      // Descarga y verifica TODO primero. No toca stores hasta tener la fotografía completa.
      for(const d of SYNC_DOMAINS.filter(d=>pf.allowedDomains.includes(d.id))){
        state.domains[d.id]={status:'DOWNLOADING',expected:pf.remoteCounts[d.id],downloaded:0};state.updatedAt=nowIso();await put(STORES.meta,state);
        downloaded[d.id]=await this.downloadDomain(d.id,{batchSize,onProgress:p=>onProgress({...p,label:d.label,globalDone:globalDone+p.done,globalTotal})});
        globalDone+=downloaded[d.id].length;state.domains[d.id]={status:'DOWNLOADED',expected:pf.remoteCounts[d.id],downloaded:downloaded[d.id].length};state.updatedAt=nowIso();await put(STORES.meta,state);
      }
      state.status='APPLYING';state.updatedAt=nowIso();await put(STORES.meta,state);
      // Firebase es la fotografía autoritativa para una PC nueva: reemplaza solo stores cloud-domain.
      for(const d of SYNC_DOMAINS.filter(d=>pf.allowedDomains.includes(d.id))){
        await clearStore(STORES[d.store]);
        if(downloaded[d.id].length)await putManyDirect(STORES[d.store],downloaded[d.id]);
        state.domains[d.id]={...state.domains[d.id],status:'APPLIED'};state.updatedAt=nowIso();await put(STORES.meta,state);
      }
      const localCounts=await this.localCounts();let ok=true;
      for(const d of SYNC_DOMAINS.filter(d=>pf.allowedDomains.includes(d.id))){const match=Number(localCounts[d.id])===Number(pf.remoteCounts[d.id]);state.domains[d.id]={...state.domains[d.id],local:localCounts[d.id],remote:pf.remoteCounts[d.id],status:match?'VERIFIED':'COUNT_MISMATCH'};if(!match)ok=false}
      if(!ok)throw new Error('Bootstrap aplicado, pero la verificación Local = Firebase detectó diferencias.');
      const completedAt=nowIso();state.status='COMPLETE';state.completedAt=completedAt;state.updatedAt=completedAt;state.localCounts=localCounts;await put(STORES.meta,state);
      for(const d of SYNC_DOMAINS.filter(d=>pf.allowedDomains.includes(d.id)))await syncStateRepository.patch(d.id,{status:SYNC_STATUS.SYNCED,lastSuccessAt:completedAt,lastPullAt:completedAt,lastError:null,bootstrapAt:completedAt,bootstrapSource:'FIREBASE',live:false});
      await auditRepository.record({action:'INITIAL_CLOUD_BOOTSTRAP_COMPLETE',domain:'SYSTEM',entityId:String(pf.manifest.baselineId||'CLOUD'),entityType:'CloudBootstrap',userId:'LOCAL_ADMIN',metadata:{remoteCounts:pf.remoteCounts,projectId:pf.health.projectId,namespace:pf.health.namespace}});
      return {ok:true,state,localCounts,remoteCounts:pf.remoteCounts,manifest:pf.manifest};
    }catch(e){state.status='ERROR';state.updatedAt=nowIso();state.lastError=String(e?.message||e);await put(STORES.meta,state);throw e}
  }
}
