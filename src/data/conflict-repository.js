import {get,put,getAll} from './database.js';
import {STORES} from './schema.js';
import {auditRepository} from './audit-repository.js';
import {eventBus} from '../core/event-bus.js';
import {CONFLICT_SCHEMA_VERSION} from '../core/version-metadata.js';

const safePart=v=>String(v??'').replace(/[^a-zA-Z0-9_.:-]+/g,'_').slice(0,120);

export class ConflictRepository{
  async recordPotential({domain,entityType,entityId,localRevision,remoteRevision,localSnapshot,remoteSnapshot,differingFields=[],localDeviceId=null,remoteDeviceId=null,baseSnapshot=null,localChangedFields=[],remoteChangedFields=[],overlappingFields=[],autoMergeEligible=false}){
    const id=[safePart(domain),safePart(entityId),Number(localRevision||0),Number(remoteRevision||0)].join(':');
    const existing=await get(STORES.conflicts,id);
    if(existing)return existing;
    const detectedAt=new Date().toISOString();
    const row={
      id,conflictSchemaVersion:CONFLICT_SCHEMA_VERSION,status:'PENDING',resolution:null,
      domain:String(domain||'').toUpperCase(),entityType:entityType||null,entityId:String(entityId||''),
      localRevision:Number(localRevision||0),remoteRevision:Number(remoteRevision||0),
      localDeviceId:localDeviceId||null,remoteDeviceId:remoteDeviceId||null,
      differingFields:[...new Set(differingFields)].sort(),
      localChangedFields:[...new Set(localChangedFields)].sort(),remoteChangedFields:[...new Set(remoteChangedFields)].sort(),overlappingFields:[...new Set(overlappingFields)].sort(),
      autoMergeEligible:!!autoMergeEligible,baseSnapshot:baseSnapshot||null,
      localSnapshot:localSnapshot||null,remoteSnapshot:remoteSnapshot||null,
      detectedAt,updatedAt:detectedAt
    };
    await put(STORES.conflicts,row);
    await auditRepository.record({action:'CONFLICT_DETECTED',domain:row.domain,entityId:row.entityId,entityType:row.entityType||'Unknown',userId:'CONFLICT_ENGINE',after:{conflictId:id,localRevision:row.localRevision,remoteRevision:row.remoteRevision,differingFields:row.differingFields,autoMergeEligible:row.autoMergeEligible}});
    eventBus.emit('conflict:detected',{conflict:row});
    return row;
  }
  get(id){return get(STORES.conflicts,id)}
  all(){return getAll(STORES.conflicts)}
  async pending(){return (await this.all()).filter(x=>String(x.status||'').toUpperCase()==='PENDING')}
  async pendingCount(){return (await this.pending()).length}
  async markAutoMerged(id,{mergedSnapshot=null,mergedRevision=0,metadata={}}={}){
    const row=await get(STORES.conflicts,id);if(!row)return null;
    const now=new Date().toISOString();
    row.status='RESOLVED';row.resolution='AUTO_MERGED';row.resolvedAt=now;row.updatedAt=now;row.mergedSnapshot=mergedSnapshot;row.mergedRevision=Number(mergedRevision||0);row.resolutionMetadata=metadata||{};
    await put(STORES.conflicts,row);
    await auditRepository.record({action:'CONFLICT_AUTO_MERGED',domain:row.domain,entityId:row.entityId,entityType:row.entityType||'Unknown',userId:'CONFLICT_ENGINE',after:{conflictId:id,mergedRevision:row.mergedRevision,localChangedFields:row.localChangedFields,remoteChangedFields:row.remoteChangedFields}});
    eventBus.emit('conflict:auto-merged',{conflict:row});
    return row;
  }
  async markManualResolved(id,{resolution,resolvedSnapshot=null,resolvedRevision=0,metadata={}}={}){
    const row=await get(STORES.conflicts,id);if(!row)return null;
    if(String(row.status||'').toUpperCase()!=='PENDING')throw new Error('Este conflicto ya fue resuelto.');
    const now=new Date().toISOString();
    row.status='RESOLVED';row.resolution=String(resolution||'MANUAL').toUpperCase();row.resolvedAt=now;row.updatedAt=now;
    row.resolvedSnapshot=resolvedSnapshot;row.resolvedRevision=Number(resolvedRevision||0);row.resolutionMetadata=metadata||{};
    await put(STORES.conflicts,row);
    await auditRepository.record({action:'CONFLICT_MANUAL_RESOLVED',domain:row.domain,entityId:row.entityId,entityType:row.entityType||'Unknown',userId:'CONFLICT_MANUAL',after:{conflictId:id,resolution:row.resolution,resolvedRevision:row.resolvedRevision,metadata:row.resolutionMetadata}});
    eventBus.emit('conflict:manual-resolved',{conflict:row});
    return row;
  }
}
export const conflictRepository=new ConflictRepository();
