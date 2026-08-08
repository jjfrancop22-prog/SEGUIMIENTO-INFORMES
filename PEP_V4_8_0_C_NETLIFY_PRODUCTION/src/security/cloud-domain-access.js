import {securityManager} from './security-manager.js';
import {SECURITY_PERMISSIONS as P} from './permission-engine.js';

const DOMAIN_PERMISSIONS=Object.freeze({
  SAMPLES:{read:P.SAMPLES_READ,write:P.SAMPLES_WRITE},
  LABORATORY:{read:P.LABORATORY_READ,write:P.LABORATORY_WRITE},
  REPORTS:{read:P.REPORTS_READ,write:P.REPORTS_WRITE},
  BILLING:{read:P.BILLING_READ,write:P.BILLING_WRITE},
  RECEIVABLES:{read:P.RECEIVABLES_READ,write:P.RECEIVABLES_WRITE},
  CLIENTS:{read:P.CLIENTS_READ,write:P.CLIENTS_WRITE},
  CATALOGS:{read:P.CATALOGS_READ,write:P.CATALOGS_WRITE}
});
export function domainPermission(domain){return DOMAIN_PERMISSIONS[String(domain||'').toUpperCase()]||null}
export function canReadCloudDomain(domain){const x=domainPermission(domain);return !!(x&&securityManager.authorize(x.read).allowed)}
export function canWriteCloudDomain(domain){const x=domainPermission(domain);return !!(x&&securityManager.authorize(x.write).allowed)}
export function readableCloudDomains(){return Object.keys(DOMAIN_PERMISSIONS).filter(canReadCloudDomain)}
export function writableCloudDomains(){return Object.keys(DOMAIN_PERMISSIONS).filter(canWriteCloudDomain)}
