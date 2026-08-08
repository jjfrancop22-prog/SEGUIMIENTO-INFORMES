import {put,getAll} from './database.js';
import {STORES} from './schema.js';
import {uuid} from '../core/uuid.js';
import {getDeviceId} from '../core/device.js';
export class AuditRepository{
  async record({action,domain,entityId='',entityType='',userId='SYSTEM',before=null,after=null,metadata={}}){
    const row={id:uuid(),action,domain,entityId,entityType,userId,deviceId:getDeviceId(),createdAt:new Date().toISOString(),before,after,metadata};
    await put(STORES.audit,row); return row;
  }
  all(){return getAll(STORES.audit)}
}
export const auditRepository=new AuditRepository();
