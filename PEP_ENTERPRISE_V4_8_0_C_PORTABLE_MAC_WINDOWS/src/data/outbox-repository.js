import {put,get,getAll,remove} from './database.js';
import {STORES} from './schema.js';
import {uuid} from '../core/uuid.js';
import {getDeviceId} from '../core/device.js';
import {eventBus} from '../core/event-bus.js';

const pendingStatus=x=>x?.status==='PENDING'||x?.status==='ERROR';

export class OutboxRepository{
  async enqueue({domain,operation,entityType,entityId,payload,revision}){
    const now=new Date().toISOString();
    const item={id:uuid(),domain,operation,entityType,entityId,payload,revision,status:'PENDING',attempts:0,deviceId:getDeviceId(),createdAt:now,updatedAt:now,lastError:null};
    await put(STORES.outbox,item);
    eventBus.emit('outbox:changed',{reason:'ENQUEUE',item});
    return item;
  }
  all(){return getAll(STORES.outbox)}
  async pending(domain=null){
    const rows=await this.all(),wanted=domain?String(domain).toUpperCase():null;
    return rows.filter(x=>pendingStatus(x)&&(!wanted||String(x.domain||'').toUpperCase()===wanted));
  }
  async pendingCount(domain=null){return (await this.pending(domain)).length}
  async markSent(id){
    const x=await get(STORES.outbox,id);if(!x)return null;
    x.status='SENT';x.updatedAt=new Date().toISOString();x.lastError=null;
    await put(STORES.outbox,x);eventBus.emit('outbox:changed',{reason:'SENT',item:x});return x;
  }
  async ackAndCleanup(id,{result='ACKED',detail=null}={}){
    const x=await get(STORES.outbox,id);if(!x)return {removed:false,item:null};
    x.status=result;x.updatedAt=new Date().toISOString();x.lastError=null;x.ackedAt=x.updatedAt;if(detail)x.ackDetail=detail;
    // Persistir primero el ACK y después retirar físicamente la operación del Outbox.
    // Si el navegador cae entre ambas operaciones, cleanupConfirmed() la retirará al próximo arranque/refresco.
    await put(STORES.outbox,x);
    await remove(STORES.outbox,id);
    eventBus.emit('outbox:changed',{reason:result,item:x,removed:true});
    return {removed:true,item:x};
  }
  async cleanupConfirmed(){
    const rows=await this.all();
    const confirmed=rows.filter(x=>['SENT','ACKED','ACK_SUPERSEDED','PROCESSED'].includes(String(x.status||'').toUpperCase()));
    for(const x of confirmed)await remove(STORES.outbox,x.id);
    if(confirmed.length)eventBus.emit('outbox:changed',{reason:'CLEANUP_CONFIRMED',removed:confirmed.length});
    return confirmed.length;
  }
  async resetForRetry(id){
    const x=await get(STORES.outbox,id);if(!x)return null;
    if(String(x.status||'').toUpperCase()!=='ERROR')throw new Error('Solo los registros ERROR pueden volver a PENDING desde el Inspector.');
    x.status='PENDING';x.updatedAt=new Date().toISOString();x.lastError=null;
    await put(STORES.outbox,x);eventBus.emit('outbox:changed',{reason:'MANUAL_RETRY_QUEUE',item:x});return x;
  }
  async removeInspected(id,reason='MANUAL_INSPECTOR_REMOVE'){
    const x=await get(STORES.outbox,id);if(!x)return null;
    await remove(STORES.outbox,id);eventBus.emit('outbox:changed',{reason,item:x,removed:true});return x;
  }

  async supersedeEntity(domain,entityId,reason='AUTO_MERGE_SUPERSEDE'){
    const rows=await this.pending(domain);let removed=0;
    for(const x of rows){
      if(String(x.entityId||'')!==String(entityId||''))continue;
      await remove(STORES.outbox,x.id);removed++;
      eventBus.emit('outbox:changed',{reason,item:x,removed:true});
    }
    return removed;
  }
  async markError(id,error){
    const x=await get(STORES.outbox,id);if(!x)return null;
    x.status='ERROR';x.attempts=(x.attempts||0)+1;x.lastError=String(error||'Error');x.updatedAt=new Date().toISOString();
    await put(STORES.outbox,x);eventBus.emit('outbox:changed',{reason:'ERROR',item:x});return x;
  }
}
export const outboxRepository=new OutboxRepository();
