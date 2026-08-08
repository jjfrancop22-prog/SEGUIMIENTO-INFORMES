import {get,put,getAll} from './database.js';
import {STORES} from './schema.js';
import {SYNC_STATUS} from '../sync/sync-constants.js';
const idFor=d=>`sync:${String(d).toUpperCase()}`;
export class SyncStateRepository{
  async get(domain){return await get(STORES.syncState,idFor(domain))||null}
  async ensure(domain){const old=await this.get(domain);if(old)return old;const now=new Date().toISOString();const row={id:idFor(domain),domain:String(domain).toUpperCase(),status:SYNC_STATUS.LOCAL_ONLY,cursor:null,lastPushAt:null,lastPullAt:null,lastSuccessAt:null,lastError:null,updatedAt:now};await put(STORES.syncState,row);return row}
  async patch(domain,patch){const row=await this.ensure(domain);const next={...row,...patch,id:row.id,domain:row.domain,updatedAt:new Date().toISOString()};await put(STORES.syncState,next);return next}
  all(){return getAll(STORES.syncState)}
}
export const syncStateRepository=new SyncStateRepository();
