import {SECURITY_PERMISSIONS as P} from './permission-engine.js';

const operationalRead=[P.SAMPLES_READ,P.LABORATORY_READ,P.REPORTS_READ,P.BILLING_READ,P.RECEIVABLES_READ];

export const MODULE_PERMISSION_MANIFEST=Object.freeze({
  dashboard:{id:'dashboard',label:'Dashboard',readAny:operationalRead,write:null,views:{executiveDashboard:{label:'Dashboard Ejecutivo',readAny:operationalRead}}},
  monitoring:{id:'monitoring',label:'Monitoreo',read:P.SAMPLES_READ,write:P.SAMPLES_WRITE,views:{
    register:{label:'Nuevas Muestras',read:P.SAMPLES_READ,write:P.SAMPLES_WRITE},
    registry:{label:'Registro de Muestras',read:P.SAMPLES_READ,write:P.SAMPLES_WRITE},
    analysis:{label:'Registro de Análisis',read:P.SAMPLES_READ,write:P.SAMPLES_WRITE},
    waiting:{label:'En Espera',read:P.SAMPLES_READ,write:P.SAMPLES_WRITE},
    stopped:{label:'Detenidas',read:P.SAMPLES_READ,write:P.SAMPLES_WRITE},
    catalogs:{label:'Catálogos',readAny:[P.CLIENTS_READ,P.CATALOGS_READ],writeAny:[P.CLIENTS_WRITE,P.CATALOGS_WRITE]},
    import:{label:'Importar Excel',read:P.SAMPLES_WRITE,write:P.SAMPLES_WRITE}
  }},
  laboratory:{id:'laboratory',label:'Laboratorio',read:P.LABORATORY_READ,write:P.LABORATORY_WRITE,views:{laboratory:{label:'Ingreso y Workspace',read:P.LABORATORY_READ,write:P.LABORATORY_WRITE}}},
  reports:{id:'reports',label:'Informes',read:P.REPORTS_READ,write:P.REPORTS_WRITE,views:{
    reportsPending:{label:'Informes Pendientes',read:P.REPORTS_READ,write:P.REPORTS_WRITE},
    reportsAuthorization:{label:'Autorización',read:P.REPORTS_READ,write:P.REPORTS_WRITE},
    reportsPortal:{label:'Portal Cliente',read:P.REPORTS_READ,write:P.REPORTS_WRITE},
    reportsFinal:{label:'Control Final',read:P.REPORTS_READ,write:P.REPORTS_WRITE}
  }},
  billing:{id:'billing',label:'Facturación',read:P.BILLING_READ,write:P.BILLING_WRITE,views:{billingControl:{label:'Control de Facturación',read:P.BILLING_READ,write:P.BILLING_WRITE}}},
  receivables:{id:'receivables',label:'Cuentas por Cobrar',read:P.RECEIVABLES_READ,write:P.RECEIVABLES_WRITE,views:{receivablesControl:{label:'Workspace de Cobranza',read:P.RECEIVABLES_READ,write:P.RECEIVABLES_WRITE}}},
  tracking:{id:'tracking',label:'Seguimiento',readAny:operationalRead,write:null,views:{trackingCenter:{label:'Centro de Seguimiento',readAny:operationalRead}}},
  system:{id:'system',label:'Sistema',readAny:[P.SYSTEM_VIEW,P.SECURITY_VIEW,P.SECURITY_ADMIN],write:P.SECURITY_ADMIN,views:{
    architecture:{label:'Arquitectura',read:P.SYSTEM_VIEW},
    syncFoundation:{label:'Sincronización',read:P.SECURITY_VIEW},
    conflictReview:{label:'Conflictos',read:P.SECURITY_VIEW},
    securityFoundation:{label:'Seguridad',read:P.SECURITY_VIEW}
  }}
});

export function moduleDeclaration(moduleId){return MODULE_PERMISSION_MANIFEST[moduleId]||null}
export function viewDeclaration(viewId,moduleId=null){
  if(moduleId)return MODULE_PERMISSION_MANIFEST[moduleId]?.views?.[viewId]||null;
  for(const m of Object.values(MODULE_PERMISSION_MANIFEST)){if(m.views?.[viewId])return m.views[viewId]}
  return null;
}
export function listPermissionDeclarations(){
  return Object.values(MODULE_PERMISSION_MANIFEST).map(m=>({
    id:m.id,label:m.label,read:m.read||null,readAny:[...(m.readAny||[])],write:m.write||null,
    views:Object.entries(m.views||{}).map(([id,v])=>({id,label:v.label||id,read:v.read||null,readAny:[...(v.readAny||[])],write:v.write||null,writeAny:[...(v.writeAny||[])]}))
  }));
}
