import {get,getAll,put,clearStore,putManyDirect} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {SYNC_DOMAINS,SYNC_STATUS} from '../sync/sync-constants.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {auditRepository} from '../data/audit-repository.js';
import {getDeviceId} from '../core/device.js';
import {VERSION_METADATA} from '../core/version-metadata.js';
import {uuid} from '../core/uuid.js';

const BASELINE_ID='cloudBaseline:active';
function downloadJson(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

export class CloudFoundationCleanupService{
  async status(){
    const [baseline,outbox,audit,samples]=await Promise.all([get(STORES.meta,BASELINE_ID),getAll(STORES.outbox),getAll(STORES.audit),getAll(STORES.samples)]);
    const pending=outbox.filter(x=>x.status!=='SENT').length;
    return {baseline,outboxTotal:outbox.length,outboxPending:pending,auditCount:audit.length,sampleCount:samples.length};
  }
  async archiveOutbox(){
    const rows=await getAll(STORES.outbox);const now=new Date().toISOString();
    const payload={type:'PEP_OUTBOX_HISTORICAL_ARCHIVE',exportedAt:now,deviceId:getDeviceId(),appVersion:VERSION_METADATA.appVersion,count:rows.length,rows};
    downloadJson(`PEP_OUTBOX_HISTORICO_${now.slice(0,10)}_${rows.length}.json`,payload);return payload;
  }
  async createBaselineAndCleanup(){
    const before=await this.status();
    const baselineId=`BASELINE-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}-${uuid().slice(0,8)}`;
    const createdAt=new Date().toISOString();
    const domainCounts={};
    const domainRows={};
    for(const d of SYNC_DOMAINS){const rows=await getAll(STORES[d.store]);domainRows[d.id]=rows;domainCounts[d.id]=rows.length}
    // Respaldo reversible antes de limpiar.
    await this.archiveOutbox();
    // Marca directa: no pasa por repositorios y por tanto NO vuelve a llenar Outbox.
    for(const d of SYNC_DOMAINS){
      const rows=domainRows[d.id];
      if(!rows.length)continue;
      const tagged=rows.map(x=>({...x,revision:Math.max(1,Number(x.revision||0)),syncSchemaVersion:VERSION_METADATA.entitySyncSchemaVersion,cloudState:'READY',syncState:'BASELINE_READY',syncStatus:'CLEAN',baselineId,baselineAt:createdAt,lastSyncedAt:null}));
      await putManyDirect(STORES[d.store],tagged);
    }
    const baseline={id:BASELINE_ID,type:'CLOUD_BASELINE',baselineId,createdAt,deviceId:getDeviceId(),appVersion:'V4.0.0-A',syncProtocolVersion:VERSION_METADATA.syncProtocolVersion,entitySyncSchemaVersion:VERSION_METADATA.entitySyncSchemaVersion,domainCounts,outboxArchived:before.outboxTotal,auditPreserved:before.auditCount,status:'READY_FOR_INITIAL_CLOUD_SEED'};
    await put(STORES.meta,baseline);
    await clearStore(STORES.outbox);
    for(const d of SYNC_DOMAINS){await syncStateRepository.patch(d.id,{status:SYNC_STATUS.LOCAL_ONLY,cursor:null,lastPushAt:null,lastPullAt:null,lastSuccessAt:null,lastError:null,baselineId,baselineAt:createdAt})}
    await auditRepository.record({action:'CLOUD_BASELINE_CREATED',domain:'SYSTEM',entityId:baselineId,entityType:'CloudBaseline',userId:'LOCAL_ADMIN',metadata:{domainCounts,outboxCleared:before.outboxTotal,auditPreserved:before.auditCount}});
    return {before,after:await this.status(),baseline};
  }
}
export const cloudFoundationCleanupService=new CloudFoundationCleanupService();
