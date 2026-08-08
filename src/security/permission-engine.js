import {getAll} from '../data/database.js';
import {STORES} from '../data/schema.js';

export const SECURITY_PERMISSIONS=Object.freeze({
  SYSTEM_VIEW:'system.view', SECURITY_VIEW:'security.view', SECURITY_ADMIN:'security.admin',
  SAMPLES_READ:'samples.read', SAMPLES_WRITE:'samples.write',
  LABORATORY_READ:'laboratory.read', LABORATORY_WRITE:'laboratory.write',
  REPORTS_READ:'reports.read', REPORTS_WRITE:'reports.write',
  BILLING_READ:'billing.read', BILLING_WRITE:'billing.write',
  RECEIVABLES_READ:'receivables.read', RECEIVABLES_WRITE:'receivables.write',
  CLIENTS_READ:'clients.read', CLIENTS_WRITE:'clients.write',
  CATALOGS_READ:'catalogs.read', CATALOGS_WRITE:'catalogs.write'
});

const ALL=Object.values(SECURITY_PERMISSIONS);
export const CLOUD_ROLE_DEFINITIONS=Object.freeze({
  ADMINISTRADOR:{id:'ADMINISTRADOR',label:'Administrador',permissions:ALL},
  CALIDAD:{id:'CALIDAD',label:'Calidad',permissions:[SECURITY_PERMISSIONS.SYSTEM_VIEW,SECURITY_PERMISSIONS.SECURITY_VIEW,SECURITY_PERMISSIONS.SAMPLES_READ,SECURITY_PERMISSIONS.SAMPLES_WRITE,SECURITY_PERMISSIONS.LABORATORY_READ,SECURITY_PERMISSIONS.LABORATORY_WRITE,SECURITY_PERMISSIONS.REPORTS_READ,SECURITY_PERMISSIONS.REPORTS_WRITE,SECURITY_PERMISSIONS.CLIENTS_READ,SECURITY_PERMISSIONS.CLIENTS_WRITE,SECURITY_PERMISSIONS.CATALOGS_READ,SECURITY_PERMISSIONS.CATALOGS_WRITE]},
  LABORATORIO:{id:'LABORATORIO',label:'Laboratorio',permissions:[SECURITY_PERMISSIONS.SAMPLES_READ,SECURITY_PERMISSIONS.LABORATORY_READ,SECURITY_PERMISSIONS.LABORATORY_WRITE,SECURITY_PERMISSIONS.REPORTS_READ,SECURITY_PERMISSIONS.CLIENTS_READ,SECURITY_PERMISSIONS.CATALOGS_READ]},
  INFORMES:{id:'INFORMES',label:'Informes',permissions:[SECURITY_PERMISSIONS.SAMPLES_READ,SECURITY_PERMISSIONS.LABORATORY_READ,SECURITY_PERMISSIONS.REPORTS_READ,SECURITY_PERMISSIONS.REPORTS_WRITE,SECURITY_PERMISSIONS.CLIENTS_READ]},
  FACTURACION:{id:'FACTURACION',label:'Facturación',permissions:[SECURITY_PERMISSIONS.SAMPLES_READ,SECURITY_PERMISSIONS.REPORTS_READ,SECURITY_PERMISSIONS.BILLING_READ,SECURITY_PERMISSIONS.BILLING_WRITE,SECURITY_PERMISSIONS.CLIENTS_READ]},
  COBRANZA:{id:'COBRANZA',label:'Cuentas por Cobrar',permissions:[SECURITY_PERMISSIONS.BILLING_READ,SECURITY_PERMISSIONS.RECEIVABLES_READ,SECURITY_PERMISSIONS.RECEIVABLES_WRITE,SECURITY_PERMISSIONS.CLIENTS_READ]},
  CONSULTA:{id:'CONSULTA',label:'Solo consulta',permissions:[SECURITY_PERMISSIONS.SAMPLES_READ,SECURITY_PERMISSIONS.LABORATORY_READ,SECURITY_PERMISSIONS.REPORTS_READ,SECURITY_PERMISSIONS.CLIENTS_READ,SECURITY_PERMISSIONS.CATALOGS_READ]},
  LOCAL_LEGACY:{id:'LOCAL_LEGACY',label:'Compatibilidad local (sin enforcement)',permissions:ALL}
});

function normalizeRoleId(v){return String(v||'').trim().toUpperCase()}
const ROLE_ALIASES=Object.freeze({
  ADMIN:'ADMINISTRADOR',ADMINISTRATOR:'ADMINISTRADOR',ADMINISTRADOR:'ADMINISTRADOR',
  QUALITY:'CALIDAD',CALIDAD:'CALIDAD',
  LAB:'LABORATORIO',LABORATORY:'LABORATORIO',LABORATORIO:'LABORATORIO',
  REPORTS:'INFORMES',REPORT:'INFORMES',INFORMES:'INFORMES',
  BILLING:'FACTURACION',FACTURACION:'FACTURACION','FACTURACIÓN':'FACTURACION',
  RECEIVABLES:'COBRANZA',COLLECTIONS:'COBRANZA',COBRANZA:'COBRANZA',
  VIEWER:'CONSULTA',READONLY:'CONSULTA',READ_ONLY:'CONSULTA',CONSULTA:'CONSULTA',
  LOCAL_LEGACY:'LOCAL_LEGACY'
});
export function canonicalRoleId(value){
  const raw=normalizeRoleId(value);
  return ROLE_ALIASES[raw]||null;
}
export function resolveRoleFromClaims(claims={}){
  const c=claims||{};
  if(c.admin===true||c.securityAdmin===true||c.pepAdmin===true)return {role:'ADMINISTRADOR',source:'BOOLEAN_ADMIN_CLAIM',raw:true};
  const candidates=[c.role,c.pepRole,c.userRole,c.erpRole];
  if(Array.isArray(c.roles))candidates.push(...c.roles);
  for(const candidate of candidates){
    const role=canonicalRoleId(candidate);
    if(role&&role!=='LOCAL_LEGACY')return {role,source:'CUSTOM_CLAIM',raw:candidate};
  }
  return {role:'LOCAL_LEGACY',source:'FALLBACK_LOCAL_LEGACY',raw:null};
}
export class PermissionEngine{
  constructor(){this.roles=new Map(Object.entries(CLOUD_ROLE_DEFINITIONS));this.identityContext=null;}
  setIdentityContext(session){
    this.identityContext=session?{...session,claims:{...(session.claims||{})}}:null;
    return this.identityContext
  }
  async init(){
    const persisted=await getAll(STORES.roles).catch(()=>[]);
    for(const row of persisted){
      const id=normalizeRoleId(row?.id||row?.name||row?.role);
      if(!id)continue;
      const permissions=Array.isArray(row.permissions)?row.permissions:Array.isArray(row.allowedPermissions)?row.allowedPermissions:null;
      if(permissions)this.roles.set(id,{id,label:row.label||row.name||id,permissions:[...new Set(permissions)] ,source:'LOCAL_ROLE_STORE'});
    }
    return this;
  }
  listRoles(){return [...this.roles.values()].map(r=>({...r,permissions:[...(r.permissions||[])]}))}
  getRole(roleId){return this.roles.get(normalizeRoleId(roleId))||null}
  permissionsFor(roleId){return new Set(this.getRole(roleId)?.permissions||[])}
  claimPermissions(){
    const c=this.identityContext?.claims||{};
    const raw=c.permissions||c.pepPermissions||c.allowedPermissions;
    if(Array.isArray(raw))return new Set(raw.map(v=>String(v||'').trim()).filter(Boolean));
    if(typeof raw==='string')return new Set(raw.split(/[;,\s]+/).map(v=>v.trim()).filter(Boolean));
    return new Set();
  }
  roleResolution(){
    const c=this.identityContext?.claims||{};
    const resolved=resolveRoleFromClaims(c);
    const current=canonicalRoleId(this.identityContext?.role);
    return {role:current||resolved.role,claimRole:resolved.role,source:this.identityContext?.roleSource||resolved.source,raw:this.identityContext?.roleClaimRaw??resolved.raw};
  }
  effectivePermissions(roleId=this.identityContext?.role||'LOCAL_LEGACY'){const out=this.permissionsFor(roleId);for(const p of this.claimPermissions())out.add(p);return out}
  can(roleId,permission){return this.effectivePermissions(roleId).has(permission)}
}

export const permissionEngine=new PermissionEngine();
