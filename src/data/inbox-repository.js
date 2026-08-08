import {put,get,getAll} from './database.js';
import {STORES} from './schema.js';
import {uuid} from '../core/uuid.js';
export class InboxRepository{
  async receive(change){const row={id:change.id||uuid(),receivedAt:new Date().toISOString(),processed:false,processedAt:null,processingResult:null,...change};await put(STORES.inbox,row);return row}
  all(){return getAll(STORES.inbox)}
  async markProcessed(id,{result='PROCESSED'}={}){const row=await get(STORES.inbox,id);if(!row)return null;row.processed=true;row.processedAt=new Date().toISOString();row.processingResult=result;await put(STORES.inbox,row);return row}
}
export const inboxRepository=new InboxRepository();
