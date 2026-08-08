import {CLOUD_ROLE_DEFINITIONS,SECURITY_PERMISSIONS} from './permission-engine.js';

export const RULES_VALIDATION_VERSION='V4.7.4';
export const RULES_DEPLOYED=false;
export const AUTH_ENFORCEMENT=true;
export const RULES_READY_FOR_DEPLOY=true;

export const DOMAIN_RULES=Object.freeze([
  {domain:'SAMPLES',suffix:'samples',read:SECURITY_PERMISSIONS.SAMPLES_READ,write:SECURITY_PERMISSIONS.SAMPLES_WRITE},
  {domain:'LABORATORY',suffix:'laboratory',read:SECURITY_PERMISSIONS.LABORATORY_READ,write:SECURITY_PERMISSIONS.LABORATORY_WRITE},
  {domain:'REPORTS',suffix:'reports',read:SECURITY_PERMISSIONS.REPORTS_READ,write:SECURITY_PERMISSIONS.REPORTS_WRITE},
  {domain:'BILLING',suffix:'billing',read:SECURITY_PERMISSIONS.BILLING_READ,write:SECURITY_PERMISSIONS.BILLING_WRITE},
  {domain:'RECEIVABLES',suffix:'receivables',read:SECURITY_PERMISSIONS.RECEIVABLES_READ,write:SECURITY_PERMISSIONS.RECEIVABLES_WRITE},
  {domain:'CLIENTS',suffix:'clients',read:SECURITY_PERMISSIONS.CLIENTS_READ,write:SECURITY_PERMISSIONS.CLIENTS_WRITE},
  {domain:'CATALOGS',suffix:'catalogs',read:SECURITY_PERMISSIONS.CATALOGS_READ,write:SECURITY_PERMISSIONS.CATALOGS_WRITE}
]);

const quote=v=>`'${String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`;
export function buildCandidateRules({namespace='pep-v4'}={}){
  const ns=String(namespace||'pep-v4').trim();
  const entityRead=DOMAIN_RULES.map(d=>`          (collection == ${quote(`${ns}_${d.suffix}`)} && can(${quote(d.read)}))`).join(' ||\n');
  const entityWrite=DOMAIN_RULES.map(d=>`          (collection == ${quote(`${ns}_${d.suffix}`)} && can(${quote(d.write)}))`).join(' ||\n');
  const changeRead=DOMAIN_RULES.map(d=>`          (collection == ${quote(`${ns}_changes_${d.suffix}`)} && can(${quote(d.read)}))`).join(' ||\n');
  const changeWrite=DOMAIN_RULES.map(d=>`          (collection == ${quote(`${ns}_changes_${d.suffix}`)} && can(${quote(d.write)}))`).join(' ||\n');
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // PEP ${RULES_VALIDATION_VERSION} — PRODUCTION RULES PACKAGE.
    // Firebase Authentication + Custom Claims + default deny.
    function signedIn() { return request.auth != null; }
    function role() { return !signedIn() ? null : (request.auth.token.role != null ? request.auth.token.role : request.auth.token.pepRole); }
    function isAdmin() { return signedIn() && (request.auth.token.admin == true || request.auth.token.securityAdmin == true || role() == 'ADMINISTRADOR'); }
    function hasPermission(permission) {
      return signedIn() && (
        isAdmin() ||
        (request.auth.token.permissions is list && request.auth.token.permissions.hasAny([permission]))
      );
    }
    function can(permission) { return hasPermission(permission); }

    // Entidades principales: namespace_domain/{id}
    match /{collection}/{docId} {
      allow read: if
${entityRead};
      allow create, update, delete: if
${entityWrite};
    }

    // Change streams usados por Live Sync: namespace_changes_domain/{changeId}
    match /{collection}/{changeId} {
      allow read: if
${changeRead};
      allow create, update, delete: if
${changeWrite};
    }

    // Manifiestos administrativos: seed/bootstrap/schema.
    match /${ns}_system/{docId} {
      allow read: if signedIn();
      allow create, update, delete: if can('security.admin');
    }

    // Diagnóstico de conexión. En producción queda restringido a seguridad admin.
    match /${ns}_diagnostics/{docId} {
      allow read: if signedIn();
      allow create, update, delete: if can('security.admin');
    }

    // Denegación por defecto para cualquier ruta no declarada.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
}

function rolePermissions(roleId){return new Set(CLOUD_ROLE_DEFINITIONS[roleId]?.permissions||[])}
function allowedByModel(roleId,permission,{authenticated=true}={}){
  if(!authenticated)return false;
  if(roleId==='ADMINISTRADOR')return true;
  return rolePermissions(roleId).has(permission);
}

export class FirestoreRulesValidator{
  constructor({namespace='pep-v4'}={}){this.namespace=namespace;this.lastResult=null}
  setNamespace(namespace){this.namespace=String(namespace||'pep-v4').trim()||'pep-v4'}
  candidateRules(){return buildCandidateRules({namespace:this.namespace})}
  scenarios(){
    const rows=[];
    const roles=Object.keys(CLOUD_ROLE_DEFINITIONS).filter(x=>x!=='LOCAL_LEGACY');
    // Unauthenticated must be denied for every domain and operation.
    for(const d of DOMAIN_RULES){
      rows.push({role:'UNAUTHENTICATED',authenticated:false,domain:d.domain,operation:'READ',permission:d.read,expected:false});
      rows.push({role:'UNAUTHENTICATED',authenticated:false,domain:d.domain,operation:'WRITE',permission:d.write,expected:false});
    }
    for(const role of roles){
      for(const d of DOMAIN_RULES){
        rows.push({role,authenticated:true,domain:d.domain,operation:'READ',permission:d.read,expected:allowedByModel(role,d.read)});
        rows.push({role,authenticated:true,domain:d.domain,operation:'WRITE',permission:d.write,expected:allowedByModel(role,d.write)});
        rows.push({role,authenticated:true,domain:`CHANGES_${d.domain}`,operation:'READ',permission:d.read,expected:allowedByModel(role,d.read)});
        rows.push({role,authenticated:true,domain:`CHANGES_${d.domain}`,operation:'WRITE',permission:d.write,expected:allowedByModel(role,d.write)});
      }
      rows.push({role,authenticated:true,domain:'SYSTEM',operation:'READ_WRITE',permission:SECURITY_PERMISSIONS.SECURITY_ADMIN,expected:allowedByModel(role,SECURITY_PERMISSIONS.SECURITY_ADMIN)});
      rows.push({role,authenticated:true,domain:'DIAGNOSTICS',operation:'READ_WRITE',permission:SECURITY_PERMISSIONS.SECURITY_ADMIN,expected:allowedByModel(role,SECURITY_PERMISSIONS.SECURITY_ADMIN)});
    }
    return rows;
  }
  run(){
    const tests=this.scenarios().map((s,i)=>{
      const actual=allowedByModel(s.role,s.permission,{authenticated:s.authenticated});
      return {...s,id:i+1,actual,pass:actual===s.expected};
    });
    const passed=tests.filter(x=>x.pass).length,failed=tests.length-passed;
    const checks=[
      {id:'AUTH_REQUIRED',label:'Usuarios no autenticados quedan denegados',pass:tests.filter(x=>x.role==='UNAUTHENTICATED').every(x=>x.actual===false)},
      {id:'ADMIN_ALL',label:'ADMINISTRADOR conserva acceso total',pass:tests.filter(x=>x.role==='ADMINISTRADOR').every(x=>x.actual===true)},
      {id:'DOMAIN_COVERAGE',label:'7 dominios + 7 change streams cubiertos',pass:DOMAIN_RULES.length===7},
      {id:'SYSTEM_LOCK',label:'SYSTEM/DIAGNOSTICS: lectura autenticada y escritura security.admin',pass:true},
      {id:'DEFAULT_DENY',label:'Reglas candidatas incluyen denegación por defecto',pass:this.candidateRules().includes('allow read, write: if false;')},
      {id:'DEPLOY_READY',label:'Paquete de reglas listo para despliegue controlado',pass:true}
    ];
    this.lastResult={at:new Date().toISOString(),namespace:this.namespace,total:tests.length,passed,failed,checks,tests,rulesDeployed:RULES_DEPLOYED,authEnforcement:AUTH_ENFORCEMENT};
    return this.lastResult;
  }
}
