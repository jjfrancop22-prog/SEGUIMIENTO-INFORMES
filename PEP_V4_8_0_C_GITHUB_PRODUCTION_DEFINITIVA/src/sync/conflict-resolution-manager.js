import {outboxRepository} from '../data/outbox-repository.js';
import {conflictRepository} from '../data/conflict-repository.js';
import {auditRepository} from '../data/audit-repository.js';
import {repositories} from '../data/repositories.js';
import {put} from '../data/database.js';
import {getDeviceId} from '../core/device.js';
import {eventBus} from '../core/event-bus.js';
import {ENTITY_SYNC_SCHEMA_VERSION} from '../core/version-metadata.js';

const META_FIELDS=new Set([
  'revision','updatedAt','updatedBy','deviceId','originDeviceId','createdAt','lastLocalChangeAt','lastSyncedAt',
  'syncState','syncSchemaVersion','cloudUpdatedAt','cloudRevision','conflictSchemaVersion','deletedAt'
]);
const normalize=v=>{
  if(v===undefined)return '__undefined__';
  if(v===null||typeof v!=='object')return v;
  if(Array.isArray(v))return v.map(normalize);
  return Object.keys(v).sort().reduce((o,k)=>{o[k]=normalize(v[k]);return o},{});
};
const stable=v=>{try{return JSON.stringify(normalize(v))}catch{return String(v)}};
const businessKeys=(...rows)=>new Set(rows.flatMap(row=>Object.keys(row||{})).filter(k=>!META_FIELDS.has(k)));
function differingFields(a={},b={}){
  return [...businessKeys(a,b)].filter(k=>stable(a?.[k])!==stable(b?.[k]));
}
function changedFromBase(base={},row={}){
  return [...businessKeys(base,row)].filter(k=>stable(base?.[k])!==stable(row?.[k]));
}
function intersection(a=[],b=[]){const s=new Set(b);return a.filter(x=>s.has(x))}

export class ConflictResolutionManager{
  async findBaseSnapshot({domain,entityId,localRevision}){
    const rows=(await auditRepository.all())
      .filter(x=>String(x.domain||'').toUpperCase()===String(domain||'').toUpperCase()&&String(x.entityId||'')===String(entityId||''))
      .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    // La edición local que generó el Outbox conserva `before`: esa es la base común más fiable.
    const exact=rows.find(x=>x.before&&Number(x.after?.revision||0)===Number(localRevision||0)&&['UPDATE','CREATE'].includes(String(x.action||'').toUpperCase()));
    if(exact?.before)return exact.before;
    // Fallback conservador: último snapshot remoto confirmado anterior a la edición local.
    const remote=rows.find(x=>x.after&&String(x.action||'').toUpperCase()==='SYNC_REMOTE_APPLY'&&Number(x.after?.revision||0)<Number(localRevision||0));
    return remote?.after||null;
  }
  async analyzeIncoming({domain,entityType,entityId,local,remote,remoteRevision}){
    if(!local||!remote)return {conflict:null,autoMerge:null};
    const localRevision=Number(local.revision||0),remoteRev=Number(remoteRevision||remote.revision||0);
    if(remoteRev<localRevision)return {conflict:null,autoMerge:null};
    const pending=(await outboxRepository.pending(domain)).find(x=>String(x.entityId||'')===String(entityId||local.id||''));
    if(!pending)return {conflict:null,autoMerge:null};
    const localDeviceId=String(local.deviceId||local.originDeviceId||pending.deviceId||'');
    const remoteDeviceId=String(remote.deviceId||remote.originDeviceId||'');
    if(localDeviceId&&remoteDeviceId&&localDeviceId===remoteDeviceId)return {conflict:null,autoMerge:null};
    const fields=differingFields(local,remote);
    if(!fields.length)return {conflict:null,autoMerge:null};

    const baseSnapshot=await this.findBaseSnapshot({domain,entityId:local.id||entityId,localRevision});
    const localChangedFields=baseSnapshot?changedFromBase(baseSnapshot,local):[];
    const remoteChangedFields=baseSnapshot?changedFromBase(baseSnapshot,remote):[];
    const overlappingFields=baseSnapshot?intersection(localChangedFields,remoteChangedFields):[];
    const autoMergeEligible=!!baseSnapshot&&localChangedFields.length>0&&remoteChangedFields.length>0&&overlappingFields.length===0;

    const conflict=await conflictRepository.recordPotential({
      domain,entityType,entityId:local.id||entityId,
      localRevision,remoteRevision:remoteRev,
      localSnapshot:local,remoteSnapshot:remote,differingFields:fields,
      localDeviceId:localDeviceId||null,remoteDeviceId:remoteDeviceId||null,
      baseSnapshot,localChangedFields,remoteChangedFields,overlappingFields,autoMergeEligible
    });

    if(!autoMergeEligible)return {conflict,autoMerge:null};
    const merged={...remote,...local};
    for(const f of remoteChangedFields)merged[f]=remote?.[f];
    for(const f of localChangedFields)merged[f]=local?.[f];
    return {conflict,autoMerge:{merged,baseSnapshot,localChangedFields,remoteChangedFields,overlappingFields}};
  }
  async resolveManual({conflictId,strategy,editedSnapshot=null}){
    const conflict=await conflictRepository.get(conflictId);
    if(!conflict)throw new Error('Conflicto no encontrado.');
    if(String(conflict.status||'').toUpperCase()!=='PENDING')throw new Error('Este conflicto ya fue resuelto.');
    const domain=String(conflict.domain||'').toUpperCase();
    const repo=Object.values(repositories).find(r=>String(r.domain||'').toUpperCase()===domain);
    if(!repo)throw new Error(`Dominio sin repositorio operativo: ${domain}`);
    const current=await repo.get(conflict.entityId);
    if(!current)throw new Error('La entidad local ya no existe.');
    const mode=String(strategy||'').toUpperCase();
    let selected=null,resolution=mode;
    if(mode==='KEEP_LOCAL')selected=conflict.localSnapshot||current;
    else if(mode==='KEEP_REMOTE')selected=conflict.remoteSnapshot;
    else if(mode==='MANUAL_MERGE'||mode==='EDITED')selected=editedSnapshot;
    else throw new Error('Estrategia de resolución no reconocida.');
    if(!selected||typeof selected!=='object'||Array.isArray(selected))throw new Error('La resolución no contiene un snapshot válido.');
    const now=new Date().toISOString(),deviceId=getDeviceId();
    const nextRevision=Math.max(Number(current.revision||0),Number(conflict.localRevision||0),Number(conflict.remoteRevision||0))+1;
    const resolved={...current,...selected,id:current.id,revision:nextRevision,updatedAt:now,updatedBy:'CONFLICT_MANUAL',deviceId,originDeviceId:current.originDeviceId||deviceId,lastLocalChangeAt:now,syncState:'LOCAL_DIRTY',syncSchemaVersion:current.syncSchemaVersion||ENTITY_SYNC_SCHEMA_VERSION};
    // Nunca permitir que un editor cambie la identidad canónica.
    if(current.uuid)resolved.uuid=current.uuid;if(current.UUID)resolved.UUID=current.UUID;
    await put(repo.store,resolved);
    await outboxRepository.supersedeEntity(domain,current.id,'MANUAL_CONFLICT_SUPERSEDE');
    await outboxRepository.enqueue({domain,operation:'UPSERT',entityType:conflict.entityType||repo.entityType,entityId:current.id,payload:resolved,revision:resolved.revision});
    await auditRepository.record({action:'CONFLICT_MANUAL_APPLY',domain,entityId:current.id,entityType:conflict.entityType||repo.entityType,userId:'CONFLICT_MANUAL',before:current,after:resolved,metadata:{conflictId,resolution}});
    const row=await conflictRepository.markManualResolved(conflictId,{resolution,resolvedSnapshot:resolved,resolvedRevision:resolved.revision,metadata:{deviceId,source:mode}});
    eventBus.emit('entity:updated',{domain,entity:resolved,before:current,conflictResolution:true});
    eventBus.emit('conflict:manual-applied',{conflict:row,entity:resolved});
    return {conflict:row,entity:resolved};
  }
  // Compatibilidad con Foundation/Review Center.
  async observeIncoming(args){return (await this.analyzeIncoming(args)).conflict}
}
export const conflictResolutionManager=new ConflictResolutionManager();
