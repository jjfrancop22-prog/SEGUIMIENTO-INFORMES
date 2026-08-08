import {outboxRepository} from '../data/outbox-repository.js';
import {inboxRepository} from '../data/inbox-repository.js';
import {syncStateRepository} from '../data/sync-state-repository.js';
import {auditRepository} from '../data/audit-repository.js';
import {get,put,getAll} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {eventBus} from '../core/event-bus.js';
import {getDeviceId} from '../core/device.js';
import {SYNC_STATUS} from './sync-constants.js';
import {conflictResolutionManager} from './conflict-resolution-manager.js';
import {conflictRepository} from '../data/conflict-repository.js';
export class DomainSyncRuntime{
  constructor(config,adapter){this.config=config;this.adapter=adapter;this.running=false}
  async status(){const [state,rows,health]=await Promise.all([syncStateRepository.ensure(this.config.id),outboxRepository.all(),this.adapter.health()]);const pending=rows.filter(x=>x.domain===this.config.id&&(x.status==='PENDING'||x.status==='ERROR')).length;return {...state,pending,connected:!!health.connected,provider:health.provider,mode:health.mode}}
  async push({allowDeletes=true}={}){
    if(this.running)return {busy:true};const health=await this.adapter.health();if(!health.connected){await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.LOCAL_ONLY,lastError:null});return {sent:0,offline:true}}
    this.running=true;await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.PUSHING,lastError:null});
    try{await outboxRepository.cleanupConfirmed();const rows=(await outboxRepository.pending(this.config.id)).filter(x=>allowDeletes||!(x.operation==='DELETE'||x.payload?.deleted)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));let sent=0,superseded=0;for(const row of rows){try{const r=await this.adapter.push(row);if(r?.accepted===false){const reason=String(r.reason||'Cambio rechazado por CloudAdapter').toUpperCase();if(reason==='CLOUD_NEWER'||reason==='STALE_REVISION'){await outboxRepository.ackAndCleanup(row.id,{result:'ACK_SUPERSEDED',detail:reason});superseded++;eventBus.emit('sync:ack',{domain:this.config.id,row,result:r,superseded:true});continue}throw new Error(r.reason||'Cambio rechazado por CloudAdapter')}await outboxRepository.ackAndCleanup(row.id,{result:'ACKED'});sent++;eventBus.emit('sync:sent',{domain:this.config.id,row,result:r});eventBus.emit('sync:ack',{domain:this.config.id,row,result:r,superseded:false})}catch(e){await outboxRepository.markError(row.id,e);await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.ERROR,lastError:String(e)});eventBus.emit('sync:error',{domain:this.config.id,row,error:e});throw e}}await outboxRepository.cleanupConfirmed();await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.SYNCED,lastPushAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),lastError:null});return {sent,superseded,offline:false}}finally{this.running=false}
  }
  async processPending(options={}){return this.push(options)}

  async applyRemote(change){
    const payload=change.payload||{};
    const remoteId=String(change.entityId||payload.id||payload.uuid||payload.UUID||'').trim();
    if(!remoteId)return {applied:false,reason:'NO_ID'};
    const store=STORES[this.config.store];
    let local=await get(store,remoteId);let canonicalId=remoteId;
    if(this.config.id==='SAMPLES'&&!local){
      const remoteUuid=String(payload.uuid||payload.UUID||remoteId).trim();
      const rows=await getAll(store);
      local=rows.find(row=>{const ids=[row?.id,row?.uuid,row?.UUID].filter(Boolean).map(v=>String(v).trim());return ids.includes(remoteId)||(remoteUuid&&ids.includes(remoteUuid))})||null;
      if(local?.id)canonicalId=String(local.id);
    }
    const remoteRev=Number(change.revision||payload.revision||0),localRev=Number(local?.revision||0);
    const remoteTime=String(payload.updatedAt||change.cloudUpdatedAt||''),localTime=String(local?.updatedAt||'');

    // V4.5.2: Smart Merge solo cuando se puede demostrar una base común y los campos editados no se superponen.
    let analysis={conflict:null,autoMerge:null};
    try{analysis=await conflictResolutionManager.analyzeIncoming({domain:this.config.id,entityType:change.entityType||this.config.repo,entityId:canonicalId,local,remote:payload,remoteRevision:remoteRev})}catch(conflictError){console.warn('Conflict Smart Merge observer:',conflictError)}
    if(analysis.autoMerge&&analysis.conflict){
      const inbox=await inboxRepository.receive({...change,domain:this.config.id,entityId:remoteId});
      const now=new Date().toISOString(),deviceId=getDeviceId();
      const merged={
        ...analysis.autoMerge.merged,
        id:canonicalId,
        revision:Math.max(localRev,remoteRev)+1,
        updatedAt:now,updatedBy:'CONFLICT_AUTO_MERGE',deviceId,
        originDeviceId:local?.originDeviceId||deviceId,
        lastLocalChangeAt:now,syncState:'LOCAL_DIRTY',syncSchemaVersion:payload.syncSchemaVersion||local?.syncSchemaVersion||1
      };
      if(this.config.id==='SAMPLES'){
        if(local?.uuid&&!merged.uuid)merged.uuid=local.uuid;
        if(local?.UUID&&!merged.UUID)merged.UUID=local.UUID;
      }
      await put(store,merged);
      await outboxRepository.supersedeEntity(this.config.id,canonicalId,'AUTO_MERGE_SUPERSEDE');
      await outboxRepository.enqueue({domain:this.config.id,operation:'UPSERT',entityType:change.entityType||this.config.repo,entityId:canonicalId,payload:merged,revision:merged.revision});
      await auditRepository.record({action:'SYNC_AUTO_MERGE_APPLY',domain:this.config.id,entityId:canonicalId,entityType:change.entityType||this.config.repo,userId:'CONFLICT_ENGINE',before:local,after:merged,metadata:{remoteRevision:remoteRev,localChangedFields:analysis.autoMerge.localChangedFields,remoteChangedFields:analysis.autoMerge.remoteChangedFields}});
      await inboxRepository.markProcessed(inbox.id,{result:'AUTO_MERGED'});
      await conflictRepository.markAutoMerged(analysis.conflict.id,{mergedSnapshot:merged,mergedRevision:merged.revision,metadata:{localChangedFields:analysis.autoMerge.localChangedFields,remoteChangedFields:analysis.autoMerge.remoteChangedFields}});
      eventBus.emit('sync:remote-applied',{domain:this.config.id,entity:merged,autoMerged:true});
      eventBus.emit('conflict:auto-merge-applied',{domain:this.config.id,entityId:canonicalId,conflictId:analysis.conflict.id});
      return {applied:true,mode:'AUTO_MERGE',entityId:canonicalId};
    }

    const wins=!local||remoteRev>localRev||(remoteRev===localRev&&remoteTime>localTime);
    const inbox=await inboxRepository.receive({...change,domain:this.config.id,entityId:remoteId});
    if(!wins){await inboxRepository.markProcessed(inbox.id,{result:'IGNORED_LOCAL_NEWER'});return {applied:false,reason:'LOCAL_NEWER'}}
    const next={...(local||{}),...payload,id:canonicalId,revision:remoteRev||payload.revision||1,syncSchemaVersion:payload.syncSchemaVersion||1,syncState:'SYNCED',lastSyncedAt:new Date().toISOString()};
    if(this.config.id==='SAMPLES'){if(local?.uuid&&!next.uuid)next.uuid=local.uuid;if(local?.UUID&&!next.UUID)next.UUID=local.UUID}
    await put(store,next);
    await auditRepository.record({action:'SYNC_REMOTE_APPLY',domain:this.config.id,entityId:canonicalId,entityType:change.entityType||this.config.repo,userId:'CLOUD_ADAPTER',after:next});
    await inboxRepository.markProcessed(inbox.id,{result:local?'UPSERT_UPDATED':'UPSERT_INSERTED'});
    eventBus.emit('sync:remote-applied',{domain:this.config.id,entity:next});
    return {applied:true,mode:local?'UPDATE':'INSERT',entityId:canonicalId}
  }
  async pull(){
    if(this.running)return {busy:true};const health=await this.adapter.health();if(!health.connected){await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.LOCAL_ONLY,lastError:null});return {received:0,offline:true}}
    this.running=true;const state=await syncStateRepository.ensure(this.config.id);await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.PULLING,lastError:null});
    try{let cursor=state.cursor,received=0,hasMore=true;while(hasMore){const page=await this.adapter.pullSince(this.config.id,cursor,500);for(const change of page.changes||[]){await this.applyRemote(change);received++}cursor=page.cursor??cursor;hasMore=!!page.hasMore}await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.SYNCED,cursor,lastPullAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),lastError:null});return {received,offline:false,cursor}}catch(e){await syncStateRepository.patch(this.config.id,{status:SYNC_STATUS.ERROR,lastError:String(e)});eventBus.emit('sync:error',{domain:this.config.id,error:e});throw e}finally{this.running=false}
  }
  async cycle(){const pushed=await this.push();const pulled=await this.pull();return {domain:this.config.id,pushed,pulled}}
}
