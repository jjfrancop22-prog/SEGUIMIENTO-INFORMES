import {eventBus} from '../core/event-bus.js';
import {outboxRepository} from '../data/outbox-repository.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {getDeviceId} from '../core/device.js';
import {canReadCloudDomain,canWriteCloudDomain} from '../security/cloud-domain-access.js';

const DOMAIN_CONFIG=Object.freeze([
  {id:'SAMPLES',label:'Monitoreo / Muestras'},
  {id:'LABORATORY',label:'Laboratorio'},
  {id:'REPORTS',label:'Informes'},
  {id:'BILLING',label:'Facturación'},
  {id:'RECEIVABLES',label:'Cuentas por Cobrar'},
  {id:'CLIENTS',label:'Clientes'},
  {id:'CATALOGS',label:'Catálogos'}
]);
const PREF_PREFIX='pep.liveSync.multiDomain.';
const LEGACY_SAMPLES_PREF='pep.liveSync.samples.enabled.v1';
const now=()=>new Date().toISOString();
const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('es-EC'):'—'};
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const slug=id=>String(id||'').toLowerCase();

export class LiveSyncManager{
  constructor(manager,{onRemoteApplied=async()=>{}}={}){
    this.manager=manager;
    this.adapter=manager.adapter;
    this.onRemoteApplied=onRemoteApplied;
    this.domains=new Map(DOMAIN_CONFIG.map(cfg=>[cfg.id,{
      ...cfg,runtime:manager.runtimeManager.domain(cfg.id),active:false,unsubscribe:null,pushing:false,
      lastRemoteAt:null,lastRemoteEntity:null,lastError:null
    }]));
    this.bound=false;this.pushTimer=null;this.pushQueue=new Set();this.refreshScheduled=null;
    // V4.4.0-A: promesa del ciclo de restauración ya existente. No crea timers nuevos;
    // únicamente permite que los paneles administrativos esperen a que el estado real
    // de los listeners termine de restaurarse antes de leerlo.
    this.restorePromise=Promise.resolve();
    this.$=id=>document.getElementById(id);
  }
  prefKey(domain){return `${PREF_PREFIX}${domain}.enabled.v1`}
  async init({restore=true}={}){
    if(!this.bound){
      this.bound=true;
      this.$('multiLiveActivateAll')?.addEventListener('click',()=>this.activateAll({manual:true}));
      this.$('multiLiveStopAll')?.addEventListener('click',()=>this.stopAll({manual:true}));
      this.$('multiLiveNowAll')?.addEventListener('click',()=>this.syncAllNow());
      document.addEventListener('click',e=>{
        const start=e.target.closest('[data-live-start]'),stop=e.target.closest('[data-live-stop]'),sync=e.target.closest('[data-live-sync]');
        if(start)this.activateDomain(start.dataset.liveStart,{manual:true}).catch(()=>{});
        if(stop)this.stopDomain(stop.dataset.liveStop,{manual:true}).catch(()=>{});
        if(sync)this.syncDomainNow(sync.dataset.liveSync).catch(()=>{});
      });
      eventBus.on('entity:created',e=>this.localEntityChanged(e.detail));
      eventBus.on('entity:updated',e=>this.localEntityChanged(e.detail));
    }
    if(localStorage.getItem(LEGACY_SAMPLES_PREF)==='1'&&!localStorage.getItem(this.prefKey('SAMPLES'))){
      localStorage.setItem(this.prefKey('SAMPLES'),'1');
    }
    // V4.4.1: si los cinco dominios operativos ya estaban configurados para Live Sync,
    // incorporar CLIENTS y CATALOGS automáticamente en la misma preferencia persistente.
    const legacyFive=['SAMPLES','LABORATORY','REPORTS','BILLING','RECEIVABLES'];
    const legacyFiveEnabled=legacyFive.every(id=>localStorage.getItem(this.prefKey(id))==='1');
    if(legacyFiveEnabled){
      if(!localStorage.getItem(this.prefKey('CLIENTS')))localStorage.setItem(this.prefKey('CLIENTS'),'1');
      if(!localStorage.getItem(this.prefKey('CATALOGS')))localStorage.setItem(this.prefKey('CATALOGS'),'1');
    }
    await this.refresh();
    if(restore)await this.restoreConfigured();
    else this.restorePromise=Promise.resolve();
  }
  configuredDomains(){return DOMAIN_CONFIG.filter(x=>localStorage.getItem(this.prefKey(x.id))==='1'&&canReadCloudDomain(x.id)).map(x=>x.id)}
  async restoreConfigured(){
    const wanted=this.configuredDomains();
    if(wanted.length){
      this.restorePromise=this.activateMany(wanted,{manual:false}).catch(()=>[]);
      await this.restorePromise;
    }else this.restorePromise=Promise.resolve();
    return this.refresh();
  }
  async whenRestored(){await (this.restorePromise||Promise.resolve());return this.refresh()}
  async ensureReady(){
    let health=await this.adapter.health();
    if(!health.connected&&health.configured&&typeof this.adapter.restoreConnection==='function'){
      await this.adapter.restoreConnection();health=await this.adapter.health();
    }
    if(!health.connected)throw new Error('Firebase no está conectado. Use Conectar Firebase primero.');
    const manifest=await this.adapter.getSeedManifest?.();
    if(!manifest||manifest.status!=='COMPLETE')throw new Error('Initial Cloud Seed no está marcado COMPLETE en Firebase.');
    return {health,manifest};
  }
  async localEntityChanged(detail={}){
    const domain=String(detail.domain||'').toUpperCase(),d=this.domains.get(domain);
    if(!d||!d.active||!canWriteCloudDomain(domain))return;
    this.pushQueue.add(domain);
    if(this.pushTimer)return;
    this.pushTimer=setTimeout(()=>this.flushPushQueue().catch(()=>{}),150);
  }
  async flushPushQueue(){
    const queue=[...this.pushQueue];this.pushQueue.clear();this.pushTimer=null;
    for(const domain of queue){try{await this.pushPending(domain)}catch{}}
    return queue.length;
  }
  async activateMany(ids,{manual=false}={}){
    await this.ensureReady();
    const results=[];
    for(const id of ids){
      try{await this.activateDomain(id,{manual,skipReady:true});results.push({id,ok:true})}
      catch(error){results.push({id,ok:false,error:String(error?.message||error)})}
    }
    await this.refresh();
    return results;
  }
  async activateAll({manual=false}={}){
    const btn=this.$('multiLiveActivateAll');if(btn){btn.disabled=true;btn.textContent='Activando…'}
    try{
      const allowed=DOMAIN_CONFIG.map(x=>x.id).filter(canReadCloudDomain);
      const results=await this.activateMany(allowed,{manual});
      const failed=results.filter(x=>!x.ok);
      if(failed.length)throw new Error(`${failed.length} dominio(s) no pudieron activarse: ${failed.map(x=>x.id).join(', ')}`);
      return results;
    }finally{if(btn){btn.disabled=false;btn.textContent='▶ Activar Live Sync completo'}await this.refresh()}
  }
  async activateDomain(domain,{manual=false,skipReady=false}={}){
    domain=String(domain||'').toUpperCase();const d=this.domains.get(domain);if(!d)throw new Error(`Dominio no soportado: ${domain}`);
    if(!canReadCloudDomain(domain))throw new Error(`Acceso cloud denegado para ${domain}: falta permiso de lectura.`);
    if(d.active){await this.refresh();return {active:true,reused:true}}
    if(!skipReady)await this.ensureReady();
    try{
      if(canWriteCloudDomain(domain))await this.pushPending(domain);
      await d.runtime.pull();
      const state=await syncStateRepository.ensure(domain);
      d.unsubscribe=this.adapter.subscribe(domain,async change=>{
        try{
          const own=String(change.deviceId||'')===String(getDeviceId());
          if(!own){
            const applied=await d.runtime.applyRemote(change);
            if(applied?.applied){
              d.lastRemoteAt=now();d.lastRemoteEntity=change.entityId||change.payload?.id||null;
              await this.onRemoteApplied(change);
            }
          }
          if(change._cursor)await syncStateRepository.patch(domain,{cursor:change._cursor,status:'SYNCED',lastPullAt:now(),lastSuccessAt:now(),lastError:null,live:true});
          this.requestRefresh();
        }catch(e){d.lastError=String(e?.message||e);await syncStateRepository.patch(domain,{status:'ERROR',lastError:d.lastError,live:d.active});this.requestRefresh()}
      },async error=>{d.lastError=String(error?.message||error);await syncStateRepository.patch(domain,{status:'ERROR',lastError:d.lastError,live:false});d.active=false;this.requestRefresh()},{cursor:state.cursor});
      d.active=true;d.lastError=null;localStorage.setItem(this.prefKey(domain),'1');
      if(domain==='SAMPLES')localStorage.setItem(LEGACY_SAMPLES_PREF,'1');
      await syncStateRepository.patch(domain,{status:'SYNCED',live:true,listenerStartedAt:now(),lastError:null});
      await this.refresh();return {active:true};
    }catch(e){
      try{d.unsubscribe?.()}catch{}d.unsubscribe=null;d.active=false;d.lastError=String(e?.message||e);
      if(manual)localStorage.removeItem(this.prefKey(domain));
      await syncStateRepository.patch(domain,{status:'ERROR',live:false,lastError:d.lastError});await this.refresh();throw e;
    }
  }
  async stopDomain(domain,{manual=false}={}){
    domain=String(domain||'').toUpperCase();const d=this.domains.get(domain);if(!d)return;
    this.pushQueue.delete(domain);
    try{d.unsubscribe?.()}catch{}d.unsubscribe=null;d.active=false;
    if(manual){localStorage.removeItem(this.prefKey(domain));if(domain==='SAMPLES')localStorage.removeItem(LEGACY_SAMPLES_PREF)}
    await syncStateRepository.patch(domain,{live:false,listenerStoppedAt:now()});await this.refresh();
  }
  async stopAll({manual=false}={}){for(const x of DOMAIN_CONFIG)await this.stopDomain(x.id,{manual});await this.refresh()}
  async pushPending(domain){
    domain=String(domain||'').toUpperCase();
    const d=this.domains.get(domain);if(!d||d.pushing)return {busy:true};
    if(!canWriteCloudDomain(domain))return {skipped:true,reason:'WRITE_NOT_AUTHORIZED'};
    d.pushing=true;
    try{
      // V4.3.0: todos los dominios principales ya tienen listener; se permite propagar soft-delete coordinado.
      const result=await d.runtime.push({allowDeletes:true});d.lastError=null;this.requestRefresh();return result;
    }catch(e){d.lastError=String(e?.message||e);this.requestRefresh();throw e}
    finally{d.pushing=false}
  }
  async syncDomainNow(domain){
    domain=String(domain||'').toUpperCase();const d=this.domains.get(domain);if(!d)throw new Error(`Dominio no soportado: ${domain}`);
    if(!canReadCloudDomain(domain))throw new Error(`Acceso cloud denegado para ${domain}: falta permiso de lectura.`);
    await this.ensureReady();if(canWriteCloudDomain(domain))await this.pushPending(domain);const p=await d.runtime.pull();d.lastError=null;await this.onRemoteApplied();await this.refresh();return p;
  }
  async syncAllNow(){
    const btn=this.$('multiLiveNowAll');if(btn){btn.disabled=true;btn.textContent='Sincronizando…'}
    try{await this.ensureReady();const out=[];for(const x of DOMAIN_CONFIG){if(!canReadCloudDomain(x.id)){out.push({id:x.id,ok:true,skipped:true,reason:'READ_NOT_AUTHORIZED'});continue}try{out.push({id:x.id,ok:true,result:await this.syncDomainNow(x.id)})}catch(error){out.push({id:x.id,ok:false,error:String(error?.message||error)})}}return out}
    finally{if(btn){btn.disabled=false;btn.textContent='↻ Sincronizar todos ahora'}await this.refresh()}
  }
  async domainStatus(domain,allOutbox=null,sharedHealth=null){
    domain=String(domain||'').toUpperCase();const d=this.domains.get(domain);const [health,state,outbox]=await Promise.all([sharedHealth?Promise.resolve(sharedHealth):this.adapter.health(),syncStateRepository.ensure(domain),allOutbox?Promise.resolve(allOutbox):outboxRepository.all()]);
    const pending=outbox.filter(x=>x.domain===domain&&(x.status==='PENDING'||x.status==='ERROR'));
    return {health,state,pending:pending.length,active:d.active,lastRemoteAt:d.lastRemoteAt,lastRemoteEntity:d.lastRemoteEntity,lastError:d.lastError||state.lastError||null};
  }
  requestRefresh(){
    if(this.refreshScheduled)return this.refreshScheduled;
    this.refreshScheduled=new Promise(resolve=>{
      const run=()=>{this.refresh().catch(()=>{}).finally(()=>{this.refreshScheduled=null;resolve()})};
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(run);else setTimeout(run,16);
    });
    return this.refreshScheduled;
  }
  async refresh(){
    const [health,outbox]=await Promise.all([this.adapter.health(),outboxRepository.all()]);
    const rows=[];for(const cfg of DOMAIN_CONFIG)rows.push({cfg,...await this.domainStatus(cfg.id,outbox,health)});
    const tbody=this.$('multiLiveRows');
    if(tbody)tbody.innerHTML=rows.map(({cfg,state,pending,active,lastRemoteAt,lastRemoteEntity,lastError})=>{
      const cursor=state.cursor?.timestampMillis?fmt(state.cursor.timestampMillis):'—';
      const remote=lastRemoteAt?`${fmt(lastRemoteAt)}${lastRemoteEntity?' · '+String(lastRemoteEntity).slice(0,10):''}`:'—';
      const authorized=canReadCloudDomain(cfg.id);
      return `<tr><td><b>${esc(cfg.label)}</b><div class="muted">${cfg.id}</div></td><td><span class="pill ${authorized?(active?'ok':'info'):'danger'}">${authorized?(active?'ACTIVO':'DETENIDO'):'NO AUTORIZADO'}</span></td><td>${authorized?pending:'—'}</td><td>${authorized?esc(cursor):'—'}</td><td>${authorized?esc(remote):'—'}</td><td>${lastError&&authorized?`<span class="pill danger" title="${esc(lastError)}">ERROR</span>`:'—'}</td><td>${authorized?`<button class="btn small primary" data-live-start="${cfg.id}" ${active?'disabled':''}>▶</button> <button class="btn small secondary" data-live-stop="${cfg.id}" ${active?'':'disabled'}>■</button> <button class="btn small blue" data-live-sync="${cfg.id}">↻</button>`:'—'}</td></tr>`;
    }).join('');
    if(this.$('multiLiveFirebase'))this.$('multiLiveFirebase').textContent=health.connected?'SÍ':'NO';
    if(this.$('multiLiveActiveCount'))this.$('multiLiveActiveCount').textContent=String(rows.filter(x=>x.active).length);
    if(this.$('multiLivePending'))this.$('multiLivePending').textContent=String(rows.reduce((s,x)=>s+x.pending,0));
    if(this.$('multiLiveDevice'))this.$('multiLiveDevice').textContent=getDeviceId();
    const errors=rows.filter(x=>x.lastError),activeCount=rows.filter(x=>x.active).length,info=this.$('multiLiveInfo');
    if(info){
      if(errors.length)info.innerHTML=`<div class="notice warn"><b>⚠️ Multi-Domain Live Sync:</b> ${errors.map(x=>`${x.cfg.id}: ${esc(x.lastError)}`).join(' · ')}</div>`;
      else if(activeCount===DOMAIN_CONFIG.filter(x=>canReadCloudDomain(x.id)).length)info.innerHTML=`<div class="notice"><b>✅ LIVE SYNC AUTORIZADO ACTIVO ${activeCount}/${DOMAIN_CONFIG.filter(x=>canReadCloudDomain(x.id)).length}.</b> Solo se abren listeners para dominios permitidos por el rol Firebase.</div>`;
      else info.innerHTML=`<div class="notice"><b>V4.8.0-C Runtime consolidado.</b> ${activeCount} de ${DOMAIN_CONFIG.length} listener(s) activos. Puede activar todos juntos o controlar cada dominio por separado.</div>`;
    }
    const allowedCount=DOMAIN_CONFIG.filter(x=>canReadCloudDomain(x.id)).length;
    const allActive=activeCount===allowedCount;if(this.$('multiLiveActivateAll'))this.$('multiLiveActivateAll').disabled=allActive;if(this.$('multiLiveStopAll'))this.$('multiLiveStopAll').disabled=activeCount===0;
    return {health,rows,activeCount};
  }
}

let liveSyncManagerSingleton=null;
export function getLiveSyncManager(manager,options={}){
  if(!liveSyncManagerSingleton)liveSyncManagerSingleton=new LiveSyncManager(manager,options);
  else if(liveSyncManagerSingleton.manager!==manager)throw new Error('LiveSyncManager ya fue configurado con otro SyncManager.');
  return liveSyncManagerSingleton;
}
