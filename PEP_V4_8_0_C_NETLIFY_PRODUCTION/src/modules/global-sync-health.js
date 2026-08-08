import {get,getAll} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {SYNC_DOMAINS} from '../sync/sync-constants.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {outboxRepository} from '../data/outbox-repository.js';
import {inboxRepository} from '../data/inbox-repository.js';
import {getDeviceId} from '../core/device.js';
import {VERSION_METADATA} from '../core/version-metadata.js';
import {eventBus} from '../core/event-bus.js';

const BASELINE_ID='cloudBaseline:active';
const SEED_STATE_ID='cloudSeed:active';
const BOOTSTRAP_STATE_ID='cloudBootstrap:active';
const MAIN_LIVE=new Set(['SAMPLES','LABORATORY','REPORTS','BILLING','RECEIVABLES','CLIENTS','CATALOGS']);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('es-EC'):'—'};
const now=()=>new Date().toISOString();

export class GlobalSyncHealthUI{
  constructor(manager,{liveController=null}={}){
    this.manager=manager;this.adapter=manager.adapter;this.liveController=liveController;this.bound=false;this.activity=[];this.lastAckAt=null;this.$=id=>document.getElementById(id);
  }
  setLiveController(x){this.liveController=x}
  addActivity(type,domain='SYSTEM',detail=''){
    this.activity.unshift({at:now(),type,domain,detail:String(detail||'')});this.activity=this.activity.slice(0,100);this.renderActivity();
  }
  async init(){
    if(!this.bound){
      this.bound=true;
      this.$('healthRefresh')?.addEventListener('click',()=>this.refreshWhenReady());
      this.$('healthReconnect')?.addEventListener('click',()=>this.reconnect());
      this.$('healthRetryOutbox')?.addEventListener('click',()=>this.retryOutbox());
      this.$('healthForcePull')?.addEventListener('click',()=>this.forcePull());
      this.$('healthRestartListeners')?.addEventListener('click',()=>this.restartListeners());
      this.$('healthExport')?.addEventListener('click',()=>this.exportDiagnostic());
      eventBus.on('sync:ack',e=>{this.lastAckAt=now();this.addActivity('ACK',e.detail?.domain,e.detail?.row?.entityId||'');this.refresh().catch(()=>{})});
      eventBus.on('sync:sent',e=>{this.addActivity('PUSH',e.detail?.domain,e.detail?.row?.entityId||'')});
      eventBus.on('sync:remote-applied',e=>{this.addActivity('PULL/APPLY',e.detail?.domain,e.detail?.entity?.id||'')});
      eventBus.on('sync:error',e=>{this.addActivity('ERROR',e.detail?.domain,e.detail?.error?.message||e.detail?.error||'')});
      eventBus.on('outbox:changed',e=>{this.addActivity('OUTBOX',e.detail?.item?.domain||'SYSTEM',e.detail?.reason||'');this.refresh().catch(()=>{})});
    }
    await this.refreshWhenReady();
  }
  async refreshWhenReady(){
    // V4.4.0-A: no pinta un estado transitorio 0/5. Espera únicamente la
    // restauración ya iniciada por LiveSyncManager y después
    // toma una fotografía real. Mientras espera, conserva la última vista válida.
    try{
      if(this.liveController&&typeof this.liveController.whenRestored==='function')await this.liveController.whenRestored();
      return await this.refresh();
    }catch(e){
      if(this.lastSnapshot)return this.lastSnapshot;
      throw e;
    }
  }
  listenerState(domain){
    if(MAIN_LIVE.has(domain))return this.liveController?.domains?.get(domain)?.active?'ACTIVO':'DETENIDO';
    return '—';
  }
  async snapshot(){
    const manifestPromise=typeof this.adapter.getSeedManifest==='function'?this.adapter.getSeedManifest().catch(()=>null):Promise.resolve(null);
    const [health,baseline,seed,bootstrap,outbox,inbox,states,manifest]=await Promise.all([
      this.adapter.health(),get(STORES.meta,BASELINE_ID),get(STORES.meta,SEED_STATE_ID),get(STORES.meta,BOOTSTRAP_STATE_ID),outboxRepository.all(),inboxRepository.all(),syncStateRepository.all(),manifestPromise
    ]);
    const stateMap=new Map(states.map(x=>[String(x.domain||'').toUpperCase(),x]));
    const domains=SYNC_DOMAINS.map(cfg=>{
      const state=stateMap.get(cfg.id)||{};
      const pending=outbox.filter(x=>String(x.domain||'').toUpperCase()===cfg.id&&['PENDING','ERROR'].includes(String(x.status||'').toUpperCase())).length;
      const inboxPending=inbox.filter(x=>String(x.domain||'').toUpperCase()===cfg.id&&!x.processed).length;
      const listener=this.listenerState(cfg.id);
      const error=state.lastError||null;
      const runtimeOk=!error&&pending===0;
      return {id:cfg.id,label:cfg.label,listener,pending,inboxPending,lastPushAt:state.lastPushAt,lastPullAt:state.lastPullAt,lastSuccessAt:state.lastSuccessAt,cursor:state.cursor,lastError:error,status:runtimeOk?'HEALTHY':'ATTENTION'};
    });
    const outboxPending=domains.reduce((s,x)=>s+x.pending,0),inboxPending=domains.reduce((s,x)=>s+x.inboxPending,0);
    const activeMain=domains.filter(x=>MAIN_LIVE.has(x.id)&&x.listener==='ACTIVO').length;
    const baselineReady=baseline?.status==='READY_FOR_INITIAL_CLOUD_SEED';
    const cloudPrepared=manifest?.status==='COMPLETE'||seed?.status==='COMPLETE'||bootstrap?.status==='COMPLETE';
    const bootstrapComplete=bootstrap?.status==='COMPLETE';
    const seedVerified=manifest?.status==='COMPLETE'||seed?.status==='COMPLETE';
    const schemaCompatible=Number(VERSION_METADATA.entitySyncSchemaVersion)===1&&Number(VERSION_METADATA.syncProtocolVersion)===1;
    const checks=[!!health.connected,activeMain===MAIN_LIVE.size,baselineReady,cloudPrepared,schemaCompatible,outboxPending===0,inboxPending===0,domains.every(x=>!x.lastError)];
    const score=Math.round(checks.filter(Boolean).length/checks.length*100);
    return {checkedAt:now(),health,baseline,seed,bootstrap,manifest,domains,outboxPending,inboxPending,activeMain,baselineReady,bootstrapComplete,seedVerified,cloudPrepared,schemaCompatible,score,lastAckAt:this.lastAckAt,deviceId:getDeviceId(),version:VERSION_METADATA};
  }
  pill(ok,yes='OK',no='REVISAR'){return `<span class="pill ${ok?'ok':'danger'}">${ok?yes:no}</span>`}
  renderActivity(){const el=this.$('healthActivity');if(!el)return;el.innerHTML=this.activity.length?this.activity.slice(0,20).map(x=>`<div class="timeline-row"><b>${esc(x.type)} · ${esc(x.domain)}</b><div>${esc(x.detail||'')}</div><div class="muted">${esc(fmt(x.at))}</div></div>`).join(''):'<div class="empty">Sin eventos de sincronización registrados en esta sesión.</div>'}
  async refresh(){
    const s=await this.snapshot();this.lastSnapshot=s;
    const set=(id,v)=>{const el=this.$(id);if(el)el.textContent=String(v)};
    set('healthScore',`${s.score}%`);set('healthFirebase',s.health.connected?'CONECTADO':'DESCONECTADO');set('healthLive',`${s.activeMain}/${MAIN_LIVE.size}`);set('healthOutbox',s.outboxPending);set('healthInbox',s.inboxPending);set('healthLastAck',fmt(s.lastAckAt));set('healthDevice',s.deviceId);
    const checks=this.$('healthGlobalChecks');if(checks)checks.innerHTML=`
      <div>${this.pill(s.health.connected,'CONECTADO','DESCONECTADO')} Firebase / CloudAdapter</div>
      <div>${this.pill(s.activeMain===MAIN_LIVE.size,'ACTIVO','INCOMPLETO')} Multi-Domain Live Sync</div>
      <div>${this.pill(s.baselineReady,'READY','PENDIENTE')} Baseline</div>
      <div>${this.pill(s.seedVerified,'VERIFICADO','NO VERIFICADO')} Initial Cloud Seed</div>
      <div>${this.pill(s.bootstrapComplete||s.seedVerified,s.bootstrapComplete?'COMPLETE':'ORIGEN SEED','PENDIENTE')} Bootstrap / Origen</div>
      <div>${this.pill(s.schemaCompatible,'COMPATIBLE','REVISAR')} Schema v${esc(s.version.entitySyncSchemaVersion)} · protocolo ${esc(s.version.syncProtocolVersion)}</div>`;
    const rows=this.$('healthDomainRows');if(rows)rows.innerHTML=s.domains.map(d=>`<tr><td><b>${esc(d.label)}</b><div class="muted">${d.id}</div></td><td>${this.pill(d.listener==='ACTIVO',d.listener,d.listener)}</td><td>${d.pending}</td><td>${d.inboxPending}</td><td>${esc(fmt(d.lastPushAt))}</td><td>${esc(fmt(d.lastPullAt))}</td><td>${d.lastError?`<span class="pill danger" title="${esc(d.lastError)}">ERROR</span>`:this.pill(true,'HEALTHY','')}</td></tr>`).join('');
    const info=this.$('healthInfo');if(info)info.innerHTML=s.score===100?'<div class="notice"><b>✅ SALUD GLOBAL 100%.</b> Firebase conectado, Live Sync operativo, Outbox/Inbox limpios y sin errores de dominio.</div>':`<div class="notice warn"><b>⚠️ SALUD GLOBAL ${s.score}%.</b> Revise los indicadores en rojo antes de una operación administrativa.</div>`;
    this.renderActivity();return s;
  }
  async reconnect(){const btn=this.$('healthReconnect');if(btn)btn.disabled=true;try{let h=await this.adapter.health();if(!h.connected){if(typeof this.adapter.restoreConnection==='function')await this.adapter.restoreConnection();h=await this.adapter.health();if(!h.connected)await this.adapter.connect()}this.addActivity('RECOVERY','SYSTEM','Firebase reconectado');await this.refresh()}catch(e){this.addActivity('ERROR','SYSTEM',e.message||e);throw e}finally{if(btn)btn.disabled=false}}
  async retryOutbox(){const btn=this.$('healthRetryOutbox');if(btn)btn.disabled=true;try{for(const d of SYNC_DOMAINS){try{await this.manager.processPending(d.id,{allowDeletes:true})}catch(e){this.addActivity('ERROR',d.id,e.message||e)}}this.addActivity('RECOVERY','SYSTEM','Reintento de Outbox ejecutado');await this.refresh()}finally{if(btn)btn.disabled=false}}
  async forcePull(){const btn=this.$('healthForcePull');if(btn)btn.disabled=true;try{for(const d of SYNC_DOMAINS){try{await this.manager.domain(d.id).pull()}catch(e){this.addActivity('ERROR',d.id,e.message||e)}}this.addActivity('RECOVERY','SYSTEM','Pull incremental ejecutado');await this.refresh()}finally{if(btn)btn.disabled=false}}
  async restartListeners(){const btn=this.$('healthRestartListeners');if(btn)btn.disabled=true;try{if(!this.liveController)throw new Error('Controlador Live Sync no disponible.');await this.liveController.stopAll({manual:false});await this.liveController.activateAll({manual:false});this.addActivity('RECOVERY','SYSTEM','Listeners reiniciados');await this.refresh()}finally{if(btn)btn.disabled=false}}
  async exportDiagnostic(){const s=await this.snapshot();const payload={type:'PEP_GLOBAL_SYNC_DIAGNOSTIC',exportedAt:now(),snapshot:s,activity:this.activity};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`PEP_SYNC_DIAGNOSTIC_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);this.addActivity('EXPORT','SYSTEM','Diagnóstico exportado')}
}
