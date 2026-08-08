export const SYNC_DOMAINS=Object.freeze([
  {id:'SAMPLES',repo:'samples',store:'samples',label:'Monitoreo / Muestras'},
  {id:'LABORATORY',repo:'laboratory',store:'laboratory',label:'Laboratorio'},
  {id:'REPORTS',repo:'reports',store:'reports',label:'Informes'},
  {id:'BILLING',repo:'billing',store:'billing',label:'Facturación'},
  {id:'RECEIVABLES',repo:'receivables',store:'receivables',label:'Cuentas por Cobrar'},
  {id:'CLIENTS',repo:'clients',store:'clients',label:'Clientes'},
  {id:'CATALOGS',repo:'catalogs',store:'catalogs',label:'Catálogos'}
]);
export const SYNC_DOMAIN_MAP=Object.freeze(Object.fromEntries(SYNC_DOMAINS.map(x=>[x.id,x])));
export const SYNC_STATUS=Object.freeze({IDLE:'IDLE',LOCAL_ONLY:'LOCAL_ONLY',PUSHING:'PUSHING',PULLING:'PULLING',SYNCED:'SYNCED',ERROR:'ERROR'});
