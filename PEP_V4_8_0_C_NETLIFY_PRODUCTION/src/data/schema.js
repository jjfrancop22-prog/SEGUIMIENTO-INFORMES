export const DB_NAME='PEP_V3_CORE_DB';
export const DB_VERSION=4;
export const STORES={
  meta:'meta', samples:'samples', laboratory:'laboratory', reports:'reports', billing:'billing', receivables:'receivables',
  clients:'clients', catalogs:'catalogs', users:'users', roles:'roles', audit:'auditLog', outbox:'outbox', inbox:'inbox', syncState:'syncState', conflicts:'conflicts'
};
export const DOMAIN_STORES=['samples','laboratory','reports','billing','receivables','clients','catalogs','users','roles'];
