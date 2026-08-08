import {getAll,putManyDirect,remove,put} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {outboxRepository} from '../data/outbox-repository.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {auditRepository} from '../data/audit-repository.js';
import {SYNC_DOMAINS,SYNC_STATUS} from '../sync/sync-constants.js';
import {domainRuntimeManager} from '../sync/domain-runtime-manager.js';
import {InitialCloudBootstrapService} from './initial-cloud-bootstrap.js';
import {canReadCloudDomain} from '../security/cloud-domain-access.js';
import {getDeviceId} from '../core/device.js';

const CORE_DOMAINS=Object.freeze(['SAMPLES','LABORATORY','REPORTS','BILLING','RECEIVABLES']);
const RECONCILE_META_ID='cloudReconciliation:last';
const $=id=>document.getElementById(id);
const nowIso=()=>new Date().toISOString();
const key=(domain,id)=>`${String(domain||'').toUpperCase()}::${String(id||'')}`;
const stamp=row=>String(row?.updatedAt||row?._sync?.clientUpdatedAt||'');
const rev=row=>Number(row?.revision||row?._sync?.revision||0);

export class CloudReconciliationManager{
  constructor(adapter){
    this.adapter=adapter;
    this.bootstrap=new InitialCloudBootstrapService(adapter);
    this.running=false;
  }
  show(title='Sincronizando PEP Enterprise…',detail='Comprobando Firebase antes de abrir el ERP.'){
    const root=$('newPcBootstrapGate');if(!root)return;
    root.classList.add('show');root.setAttribute('aria-hidden','false');
    if($('newPcBootstrapTitle'))$('newPcBootstrapTitle').textContent=title;
    if($('newPcBootstrapDetail'))$('newPcBootstrapDetail').textContent=detail;
    if($('newPcBootstrapRetry'))$('newPcBootstrapRetry').style.display='none';
    if($('newPcBootstrapContinue'))$('newPcBootstrapContinue').style.display='none';
    if($('cloudReconciliationRows'))$('cloudReconciliationRows').innerHTML='';
    this.progress(2,detail);
  }
  hide(){const root=$('newPcBootstrapGate');if(root){root.classList.remove('show');root.setAttribute('aria-hidden','true')}}
  progress(pct,text){
    const safe=Math.max(0,Math.min(100,Number(pct||0)));
    if($('newPcBootstrapBar'))$('newPcBootstrapBar').style.width=`${safe}%`;
    if($('newPcBootstrapPercent'))$('newPcBootstrapPercent').textContent=`${Math.round(safe)}%`;
    if($('newPcBootstrapDetail')&&text)$('newPcBootstrapDetail').textContent=text;
  }
  row(domain,label,status,detail=''){
    const host=$('cloudReconciliationRows');if(!host)return;
    let el=host.querySelector(`[data-reconcile-domain="${domain}"]`);
    if(!el){el=document.createElement('div');el.dataset.reconcileDomain=domain;el.className='cloud-reconcile-row';host.appendChild(el)}
    const icon=status==='OK'?'✓':status==='WARN'?'!':'…';
    el.innerHTML=`<span class="cloud-reconcile-icon ${status.toLowerCase()}">${icon}</span><b>${label}</b><small>${detail}</small>`;
  }
  async ensureConnected(){
    let health=await this.adapter.health();
    if(!health.connected&&health.configured&&typeof this.adapter.restoreConnection==='function'){await this.adapter.restoreConnection();health=await this.adapter.health()}
    if(!health.connected){if(!health.configured)throw new Error('Firebase no está configurado.');await this.adapter.connect();health=await this.adapter.health()}
    if(!health.connected)throw new Error('No fue posible conectar Firebase para reconciliar datos.');
    return health;
  }
  async localCounts(){const out={};for(const d of SYNC_DOMAINS)out[d.id]=(await getAll(STORES[d.store])).length;return out}
  async pendingProtection(){
    const rows=(await outboxRepository.all()).filter(x=>x.status==='PENDING'||x.status==='ERROR');
    const ids=new Set(rows.map(x=>key(x.domain,x.entityId)));
    return {rows,ids,count:rows.length};
  }
  async fetchSnapshot(domain,{batchSize=250,onProgress=()=>{}}={}){
    const expected=await this.adapter.countEntities(domain),rows=[];let afterId=null;
    while(true){
      const page=await this.adapter.fetchDomainPage(domain,{afterId,limitCount:batchSize});
      rows.push(...page.rows);afterId=page.nextId;
      onProgress({done:rows.length,total:expected});
      if(!page.hasMore||!page.rows.length)break;
    }
    if(rows.length!==expected)throw new Error(`${domain}: snapshot incompleto (${rows.length}/${expected}).`);
    return {rows,expected};
  }
  async fullReconcileDomain(cfg,protectedIds,{onProgress=()=>{}}={}){
    const store=STORES[cfg.store];
    const [local,{rows:remote,expected}]=await Promise.all([getAll(store),this.fetchSnapshot(cfg.id,{onProgress})]);
    const localMap=new Map(local.map(x=>[String(x.id),x]));
    const remoteMap=new Map(remote.map(x=>[String(x.id),x]));
    const upserts=[];let protectedCount=0,updated=0,inserted=0,removed=0;
    for(const cloud of remote){
      const id=String(cloud.id||'');if(!id)continue;
      if(protectedIds.has(key(cfg.id,id))){protectedCount++;continue}
      const current=localMap.get(id);
      const changed=!current||rev(cloud)!==rev(current)||stamp(cloud)!==stamp(current)||Boolean(cloud.deleted)!==Boolean(current.deleted);
      if(changed){upserts.push({...cloud,id,syncState:'SYNCED',lastSyncedAt:nowIso()});current?updated++:inserted++}
    }
    if(upserts.length)await putManyDirect(store,upserts);
    // Firebase es autoritativo para registros que NO tienen una operación local pendiente.
    for(const current of local){
      const id=String(current?.id||'');if(!id||remoteMap.has(id)||protectedIds.has(key(cfg.id,id)))continue;
      await remove(store,id);removed++;
    }
    const finalRows=await getAll(store);
    const protectedLocal=finalRows.filter(x=>protectedIds.has(key(cfg.id,x.id))).length;
    const exact=protectedLocal===0&&finalRows.length===expected;
    return {remote:expected,local:finalRows.length,inserted,updated,removed,protected:protectedCount||protectedLocal,exact};
  }
  async reconcileExisting(allowed,protection){
    const results=[];const total=allowed.length;
    for(let i=0;i<allowed.length;i++){
      const cfg=allowed[i],label=cfg.label||cfg.id,basePct=8+Math.round((i/Math.max(1,total))*84);
      this.row(cfg.id,label,'RUN','Comprobando cambios…');this.progress(basePct,`${label}: comprobando cambios en Firebase…`);
      const domainPending=protection.rows.filter(x=>String(x.domain||'').toUpperCase()===cfg.id);
      let incremental=null;
      // Sin pendientes locales podemos consumir el change-log incremental de forma segura.
      if(!domainPending.length){
        try{incremental=await domainRuntimeManager.domain(cfg.id).pull()}catch(e){incremental={error:String(e?.message||e)}}
      }
      let [local,remoteCount]=await Promise.all([getAll(STORES[cfg.store]),this.adapter.countEntities(cfg.id)]);
      let result={remote:remoteCount,local:local.length,inserted:0,updated:0,removed:0,protected:domainPending.length,exact:local.length===remoteCount&&domainPending.length===0,incrementalReceived:Number(incremental?.received||0)};
      // Si hay pendientes, si los conteos difieren o si el pull incremental falló, escanear snapshot autoritativo.
      if(domainPending.length||local.length!==remoteCount||incremental?.error){
        result=await this.fullReconcileDomain(cfg,protection.ids,{onProgress:p=>{
          const domainPct=p.total?Math.round((p.done/p.total)*(84/Math.max(1,total))):0;
          this.progress(Math.min(92,basePct+domainPct),`${label}: ${p.done} de ${p.total}`);
        }});
      }
      await syncStateRepository.patch(cfg.id,{status:SYNC_STATUS.SYNCED,lastReconcileAt:nowIso(),lastSuccessAt:nowIso(),lastError:null,reconciliationProtected:result.protected,reconciliationRemote:result.remote,reconciliationLocal:result.local});
      const detail=result.protected
        ? `${result.local}/${result.remote} · ${result.protected} pendiente(s) protegidos`
        : `${result.local}/${result.remote}${result.inserted||result.updated||result.removed?` · +${result.inserted} ~${result.updated} -${result.removed}`:''}`;
      this.row(cfg.id,label,result.protected?'WARN':'OK',detail);results.push({domain:cfg.id,...result});
    }
    return results;
  }
  async runAfterLogin(){
    if(this.running)return {ok:false,skipped:true,reason:'ALREADY_RUNNING'};
    this.running=true;this.show();
    try{
      await this.ensureConnected();
      const manifest=await this.adapter.getSeedManifest?.();
      if(!manifest||manifest.status!=='COMPLETE')throw new Error('Firebase no contiene un Initial Cloud Seed COMPLETE.');
      const allowed=SYNC_DOMAINS.filter(d=>canReadCloudDomain(d.id));
      if(!allowed.length)throw new Error('El rol autenticado no tiene dominios autorizados para sincronización.');
      const protection=await this.pendingProtection(),counts=await this.localCounts();
      const coreTotal=CORE_DOMAINS.reduce((sum,id)=>sum+Number(counts[id]||0),0);
      let mode='RECONCILE',results=[];
      if(coreTotal===0){
        mode='BOOTSTRAP';this.progress(6,'Esta computadora está vacía. Descargando fotografía inicial desde Firebase…');
        const boot=await this.bootstrap.run({batchSize:250,onProgress:p=>{
          const pct=p.globalTotal?8+Math.round((p.globalDone/p.globalTotal)*84):8;
          this.progress(pct,`${p.label||p.domain}: ${p.done||0} de ${p.total||0}`);
          this.row(p.domain,p.label||p.domain,p.done===p.total?'OK':'RUN',`${p.done||0}/${p.total||0}`);
        }});
        results=allowed.map(d=>({domain:d.id,remote:boot.remoteCounts?.[d.id]||0,local:boot.localCounts?.[d.id]||0,exact:true,protected:0}));
      }else{
        this.progress(6,protection.count?`Reconciliando con Firebase · ${protection.count} cambio(s) local(es) protegidos.`:'Reconciliando datos locales con Firebase…');
        results=await this.reconcileExisting(allowed,protection);
      }
      const completedAt=nowIso();
      await put(STORES.meta,{id:RECONCILE_META_ID,type:'CLOUD_RECONCILIATION',status:'COMPLETE',mode,completedAt,updatedAt:completedAt,deviceId:getDeviceId(),results});
      await auditRepository.record({action:'CLOUD_RECONCILIATION_COMPLETE',domain:'SYSTEM',entityId:getDeviceId(),entityType:'CloudReconciliation',userId:'AUTHENTICATED_USER',metadata:{mode,results:results.map(x=>({domain:x.domain,local:x.local,remote:x.remote,protected:x.protected}))}});
      this.progress(100,protection.count?'Datos reconciliados. Los cambios pendientes permanecen protegidos.':'Cloud y Local verificados. Iniciando ERP…');
      await new Promise(r=>setTimeout(r,350));this.hide();
      return {ok:true,mode,results,protected:protection.count};
    }catch(error){
      const msg=String(error?.message||error);
      if($('newPcBootstrapTitle'))$('newPcBootstrapTitle').textContent='No se pudo verificar la sincronización';
      this.progress(0,msg);
      this.hide();
      throw error;
    }finally{this.running=false}
  }
}
