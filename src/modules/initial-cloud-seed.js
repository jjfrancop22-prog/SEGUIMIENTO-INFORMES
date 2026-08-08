import {get,getAll,put,putManyDirect} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {SYNC_DOMAINS,SYNC_STATUS} from '../sync/sync-constants.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {auditRepository} from '../data/audit-repository.js';
import {getDeviceId} from '../core/device.js';
import {VERSION_METADATA} from '../core/version-metadata.js';

const BASELINE_ID='cloudBaseline:active';
const SEED_STATE_ID='cloudSeed:active';
const nowIso=()=>new Date().toISOString();

export class InitialCloudSeedService{
  constructor(adapter){this.adapter=adapter}
  async localSnapshot(){
    const baseline=await get(STORES.meta,BASELINE_ID);
    const outbox=await getAll(STORES.outbox);
    const domains=[];
    for(const d of SYNC_DOMAINS){const rows=await getAll(STORES[d.store]);domains.push({...d,count:rows.length,rows})}
    return {baseline,outboxPending:outbox.filter(x=>x.status!=='SENT').length,domains,total:domains.reduce((a,x)=>a+x.count,0)};
  }
  async status(){return (await get(STORES.meta,SEED_STATE_ID))||{id:SEED_STATE_ID,status:'NOT_STARTED',domains:{}}}
  async preflight(){
    const local=await this.localSnapshot();
    let health=await this.adapter.health();
    // V4.0.2-A: la conexión Firebase es estado de memoria. Si la configuración
    // persiste pero una recarga dejó connected=false, el Preflight reconecta
    // exactamente el mismo CloudAdapter antes de leer Firestore. No escribe datos.
    if(!health.connected){
      if(!health.configured)throw new Error('Firebase no está configurado. Complete y guarde la configuración antes del Cloud Seed.');
      await this.adapter.connect();
      health=await this.adapter.health();
    }
    if(!health.connected)throw new Error('Firebase Adapter no pudo establecer conexión para el Preflight.');
    if(local.baseline?.status!=='READY_FOR_INITIAL_CLOUD_SEED')throw new Error('Cloud Baseline no está READY. No ejecute el Seed.');
    if(local.outboxPending!==0)throw new Error(`Outbox tiene ${local.outboxPending} operación(es) pendiente(s). Debe estar en 0 antes del Seed inicial.`);
    const remote={};
    for(const d of local.domains)remote[d.id]=await this.adapter.countEntities(d.id);
    const manifest=await this.adapter.getSeedManifest();
    return {ok:true,health,baseline:local.baseline,localCounts:Object.fromEntries(local.domains.map(x=>[x.id,x.count])),remoteCounts:remote,manifest};
  }
  async run({batchSize=250,onProgress=()=>{}}={}){
    const pf=await this.preflight();
    const baselineId=pf.baseline.baselineId;
    const previous=await this.status();
    if(previous.status==='COMPLETE'&&previous.baselineId===baselineId)return {alreadyComplete:true,state:previous,verification:await this.verify()};
    const startedAt=previous.startedAt||nowIso();
    const state={id:SEED_STATE_ID,type:'INITIAL_CLOUD_SEED',status:'RUNNING',baselineId,startedAt,updatedAt:nowIso(),projectId:pf.health.projectId,namespace:pf.health.namespace,deviceId:getDeviceId(),batchSize,domains:previous.baselineId===baselineId?(previous.domains||{}):{}};
    await put(STORES.meta,state);
    await this.adapter.writeSeedManifest({status:'RUNNING',baselineId,startedAt,deviceId:getDeviceId(),localCounts:pf.localCounts,appVersion:VERSION_METADATA.appVersion});
    const local=await this.localSnapshot();
    let globalDone=0;const globalTotal=local.total;
    try{
      for(const d of local.domains){
        const domainState=state.domains[d.id]||{};
        const beforeRemote=await this.adapter.countEntities(d.id);
        state.domains[d.id]={...domainState,status:'RUNNING',local:d.count,remoteBefore:beforeRemote,uploaded:0,error:null,startedAt:domainState.startedAt||nowIso()};
        await put(STORES.meta,{...state,updatedAt:nowIso()});
        onProgress({phase:'DOMAIN_START',domain:d.id,label:d.label,domainDone:0,domainTotal:d.count,globalDone,globalTotal});
        const result=await this.adapter.seedDomain(d.id,d.rows,{baselineId,batchSize,onProgress:p=>onProgress({...p,label:d.label,globalDone:globalDone+p.done,globalTotal})});
        globalDone+=d.count;
        const remoteAfter=await this.adapter.countEntities(d.id);
        state.domains[d.id]={...state.domains[d.id],status:remoteAfter===d.count?'VERIFIED':'COUNT_MISMATCH',uploaded:result.written,remoteAfter,completedAt:nowIso()};
        state.updatedAt=nowIso();await put(STORES.meta,state);
        if(remoteAfter!==d.count)throw new Error(`${d.id}: conteo remoto ${remoteAfter} no coincide con local ${d.count}.`);
        onProgress({phase:'DOMAIN_DONE',domain:d.id,label:d.label,domainDone:d.count,domainTotal:d.count,globalDone,globalTotal});
      }
      const verification=await this.verify();
      if(!verification.ok)throw new Error('La verificación final detectó conteos diferentes entre IndexedDB y Firestore.');
      state.status='COMPLETE';state.completedAt=nowIso();state.updatedAt=state.completedAt;state.verification=verification;
      await put(STORES.meta,state);
      await this.adapter.writeSeedManifest({status:'COMPLETE',baselineId,startedAt,completedAt:state.completedAt,deviceId:getDeviceId(),localCounts:verification.localCounts,remoteCounts:verification.remoteCounts,appVersion:VERSION_METADATA.appVersion});
      const syncedAt=state.completedAt;
      for(const d of local.domains){
        if(d.rows.length){await putManyDirect(STORES[d.store],d.rows.map(x=>({...x,cloudState:'SEEDED',syncState:'SYNCED',syncStatus:'CLEAN',lastSyncedAt:syncedAt,baselineId})))}
        await syncStateRepository.patch(d.id,{status:SYNC_STATUS.SYNCED,lastSuccessAt:syncedAt,lastPushAt:syncedAt,lastError:null,baselineId,seededAt:syncedAt});
      }
      await auditRepository.record({action:'INITIAL_CLOUD_SEED_COMPLETE',domain:'SYSTEM',entityId:baselineId,entityType:'CloudSeed',userId:'LOCAL_ADMIN',metadata:{localCounts:verification.localCounts,remoteCounts:verification.remoteCounts,projectId:pf.health.projectId,namespace:pf.health.namespace}});
      return {alreadyComplete:false,state,verification};
    }catch(e){
      state.status='ERROR';state.updatedAt=nowIso();state.lastError=String(e?.message||e);await put(STORES.meta,state);
      await this.adapter.writeSeedManifest({status:'ERROR',baselineId,startedAt,lastError:state.lastError,deviceId:getDeviceId(),appVersion:VERSION_METADATA.appVersion});
      throw e;
    }
  }
  async verify(){
    const local=await this.localSnapshot();const localCounts={},remoteCounts={},domains=[];let ok=true;
    for(const d of local.domains){localCounts[d.id]=d.count;remoteCounts[d.id]=await this.adapter.countEntities(d.id);const match=localCounts[d.id]===remoteCounts[d.id];if(!match)ok=false;domains.push({id:d.id,label:d.label,local:d.count,remote:remoteCounts[d.id],match})}
    return {ok,checkedAt:nowIso(),localCounts,remoteCounts,domains};
  }
}
