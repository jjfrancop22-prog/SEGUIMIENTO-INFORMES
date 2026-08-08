import {SYNC_DOMAINS} from './sync-constants.js';
import {DomainSyncRuntime} from './domain-sync-runtime.js';

export class DomainRuntimeManager{
  constructor(){this.adapter=null;this.runtimes=new Map();this.initialized=false}
  configure(adapter,domains=SYNC_DOMAINS){
    if(this.initialized){
      if(this.adapter!==adapter)throw new Error('DomainRuntimeManager ya fue configurado con otro CloudAdapter.');
      return this;
    }
    this.adapter=adapter;
    for(const domain of domains)this.runtimes.set(domain.id,new DomainSyncRuntime(domain,adapter));
    this.initialized=true;return this;
  }
  domain(id){const key=String(id||'').toUpperCase(),r=this.runtimes.get(key);if(!r)throw new Error(`Dominio de sincronización desconocido: ${id}`);return r}
  entries(){return this.runtimes.entries()}
  values(){return this.runtimes.values()}
  ids(){return [...this.runtimes.keys()]}
  size(){return this.runtimes.size}
}
export const domainRuntimeManager=new DomainRuntimeManager();
