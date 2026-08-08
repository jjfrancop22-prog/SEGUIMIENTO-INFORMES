import {CloudAdapter} from './cloud-adapter.js';
export class MemoryCloudAdapter extends CloudAdapter{
  constructor({failDomains=[]}={}){super();this.connected=false;this.failDomains=new Set(failDomains);this.docs=new Map();this.log=[];this.sequence=0}
  get name(){return 'MEMORY_TEST'}
  get mode(){return 'TEST_ONLY'}
  capabilities(){return {connect:true,push:true,pull:true,subscribe:false,batch:true}}
  async connect(){this.connected=true;return this.health()}
  async disconnect(){this.connected=false;return true}
  async health(){return {connected:this.connected,provider:this.name,mode:this.mode,ready:this.connected}}
  _key(domain,id){return `${domain}::${id}`}
  async push(change){
    if(!this.connected)throw new Error('MemoryCloudAdapter desconectado');
    if(this.failDomains.has(change.domain))throw new Error(`Fallo simulado en ${change.domain}`);
    const key=this._key(change.domain,change.entityId),prev=this.docs.get(key);
    const incomingRev=Number(change.revision||change.payload?.revision||0),prevRev=Number(prev?.revision||0);
    if(prev&&incomingRev<prevRev)return {accepted:false,reason:'STALE_REVISION',remoteRevision:prevRev};
    const remote={...change,payload:structuredClone(change.payload||{}),revision:incomingRev,cloudSequence:++this.sequence,cloudUpdatedAt:new Date().toISOString()};
    this.docs.set(key,remote);this.log.push(remote);
    return {accepted:true,domain:change.domain,entityId:change.entityId,revision:incomingRev,cloudSequence:remote.cloudSequence};
  }
  async pushBatch(changes=[]){const out=[];for(const c of changes)out.push(await this.push(c));return out}
  async pullSince(domain,cursor=null,limit=500){
    if(!this.connected)throw new Error('MemoryCloudAdapter desconectado');
    if(this.failDomains.has(domain))throw new Error(`Fallo simulado en ${domain}`);
    const after=Number(cursor||0);const rows=this.log.filter(x=>x.domain===domain&&x.cloudSequence>after).slice(0,limit);
    const next=rows.length?rows[rows.length-1].cloudSequence:after;
    return {domain,changes:structuredClone(rows),cursor:String(next),hasMore:this.log.some(x=>x.domain===domain&&x.cloudSequence>next)};
  }
  subscribe(){return ()=>{}}
}
