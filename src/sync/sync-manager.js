import {SYNC_DOMAINS} from './sync-constants.js';
import {domainRuntimeManager} from './domain-runtime-manager.js';
export class SyncManager{
  constructor(adapter,domains=SYNC_DOMAINS){this.adapter=adapter;this.runtimeManager=domainRuntimeManager.configure(adapter,domains)}
  domain(id){return this.runtimeManager.domain(id)}
  async connect(options={}){return this.adapter.connect(options)}
  async disconnect(){return this.adapter.disconnect()}
  async status(){const health=await this.adapter.health();const domains=[];for(const [id,r] of this.runtimeManager.entries())domains.push({id,...await r.status()});return {health,domains}}
  async runDomain(id){return this.domain(id).cycle()}
  async processPending(id,options={}){return this.domain(id).processPending(options)}
  async runAll(){const results=[];for(const [id,r] of this.runtimeManager.entries()){try{results.push({id,ok:true,result:await r.cycle()})}catch(error){results.push({id,ok:false,error:String(error)})}}return results}
}
