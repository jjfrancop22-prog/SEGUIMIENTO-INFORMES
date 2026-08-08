const norm=v=>String(v??'').trim().toUpperCase();
const truthy=v=>v===true||v===1||['TRUE','1','YES','Y','SI','SÍ'].includes(norm(v));
const deletedStates=new Set(['DELETED','DELETE','REMOVED','TOMBSTONE','SOFT_DELETED','ELIMINADO','ELIMINADA']);

/** Returns true for any supported logical-deletion representation. */
export function isTombstone(record){
  if(!record||typeof record!=='object')return false;
  if(truthy(record.deleted)||truthy(record.isDeleted)||truthy(record.softDeleted)||truthy(record.tombstone))return true;
  if(record.deletedAt||record.removedAt)return true;
  if(deletedStates.has(norm(record.syncState))||deletedStates.has(norm(record.lifecycleState))||deletedStates.has(norm(record.deletionState)))return true;
  return false;
}

export const visibleRecords=rows=>(rows||[]).filter(r=>!isTombstone(r));
export const visibleForActiveSamples=(rows,activeSampleIds)=>visibleRecords(rows).filter(r=>!r?.sampleId||activeSampleIds.has(r.sampleId));
