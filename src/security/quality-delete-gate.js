import {auditRepository} from '../data/audit-repository.js';
import {sessionManager} from './session-manager.js';

const QUALITY_DELETE_PASSWORD='CALIDAD';

function actorId(){
  const s=sessionManager.current();
  return s?.uid||s?.email||s?.displayName||'LOCAL_USER';
}

class QualityDeleteGate{
  actor(){return actorId()}
  async authorize({entityId='',entityType='ENTITY',domain='SECURITY',label='registro'}={}){
    const userId=this.actor();
    const entered=window.prompt(`ELIMINACIÓN RESTRINGIDA — CALIDAD\n\nSolo Calidad puede eliminar ${label}.\nIngrese la contraseña de Calidad para continuar:`);
    if(entered===null){
      await auditRepository.record({action:'DELETE_AUTH_CANCELLED',domain,entityId,entityType,userId,metadata:{policy:'QUALITY_PASSWORD_REQUIRED'}});
      return false;
    }
    const allowed=entered===QUALITY_DELETE_PASSWORD;
    await auditRepository.record({action:allowed?'DELETE_AUTHORIZED_BY_QUALITY':'DELETE_AUTH_DENIED',domain,entityId,entityType,userId,metadata:{policy:'QUALITY_PASSWORD_REQUIRED'}});
    if(!allowed)throw new Error('Eliminación bloqueada. Contraseña de Calidad incorrecta.');
    return true;
  }
}
export const qualityDeleteGate=new QualityDeleteGate();
