import {get,put,getAll,remove} from './database.js';
import {uuid} from '../core/uuid.js';
import {getDeviceId} from '../core/device.js';
import {auditRepository} from './audit-repository.js';
import {outboxRepository} from './outbox-repository.js';
import {eventBus} from '../core/event-bus.js';
import {ENTITY_SYNC_SCHEMA_VERSION} from '../core/version-metadata.js';
import {isTombstone} from './tombstone.js';
export class BaseRepository{
  constructor(store,domain,entityType){this.store=store;this.domain=domain;this.entityType=entityType}
  async create(data,{userId='SYSTEM',sync=true}={}){
    const now=new Date().toISOString();
    const deviceId=getDeviceId();const entity={...data,id:data.id||uuid(),revision:1,createdAt:data.createdAt||now,updatedAt:now,updatedBy:userId,deviceId,deleted:false,syncSchemaVersion:ENTITY_SYNC_SCHEMA_VERSION,syncState:sync?'LOCAL_DIRTY':'LOCAL_ONLY',originDeviceId:data.originDeviceId||deviceId,lastLocalChangeAt:now};
    await put(this.store,entity);
    await auditRepository.record({action:'CREATE',domain:this.domain,entityId:entity.id,entityType:this.entityType,userId,after:entity});
    if(sync)await outboxRepository.enqueue({domain:this.domain,operation:'UPSERT',entityType:this.entityType,entityId:entity.id,payload:entity,revision:entity.revision});
    eventBus.emit('entity:created',{domain:this.domain,entity}); return entity;
  }
  async update(id,patch,{userId='SYSTEM',sync=true}={}){
    const before=await get(this.store,id); if(!before)throw new Error(`Entidad no encontrada: ${id}`);
    const changedAt=new Date().toISOString(),deviceId=getDeviceId();const after={...before,...patch,id,revision:(before.revision||0)+1,updatedAt:changedAt,updatedBy:userId,deviceId,syncSchemaVersion:ENTITY_SYNC_SCHEMA_VERSION,syncState:sync?'LOCAL_DIRTY':(before.syncState||'LOCAL_ONLY'),originDeviceId:before.originDeviceId||deviceId,lastLocalChangeAt:changedAt};
    await put(this.store,after);
    await auditRepository.record({action:'UPDATE',domain:this.domain,entityId:id,entityType:this.entityType,userId,before,after});
    if(sync)await outboxRepository.enqueue({domain:this.domain,operation:'UPSERT',entityType:this.entityType,entityId:id,payload:after,revision:after.revision});
    eventBus.emit('entity:updated',{domain:this.domain,entity:after,before}); return after;
  }
  async softDelete(id,{userId='SYSTEM',sync=true}={}){return this.update(id,{deleted:true,deletedAt:new Date().toISOString()},{userId,sync})}
  get(id){return get(this.store,id)}
  async all({includeDeleted=false}={}){const rows=await getAll(this.store);return includeDeleted?rows:rows.filter(x=>!isTombstone(x))}
  async hardDelete(id){return remove(this.store,id)}
}
