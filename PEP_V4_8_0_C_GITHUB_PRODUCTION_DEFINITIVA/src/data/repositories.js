import {BaseRepository} from './base-repository.js';
import {STORES} from './schema.js';
export const repositories={
  samples:new BaseRepository(STORES.samples,'SAMPLES','Sample'),
  laboratory:new BaseRepository(STORES.laboratory,'LABORATORY','LaboratoryEntry'),
  reports:new BaseRepository(STORES.reports,'REPORTS','Report'),
  billing:new BaseRepository(STORES.billing,'BILLING','BillingRecord'),
  receivables:new BaseRepository(STORES.receivables,'RECEIVABLES','ReceivableRecord'),
  clients:new BaseRepository(STORES.clients,'CLIENTS','Client'),
  catalogs:new BaseRepository(STORES.catalogs,'CATALOGS','CatalogItem'),
  users:new BaseRepository(STORES.users,'USERS','User'),
  roles:new BaseRepository(STORES.roles,'ROLES','Role')
};
