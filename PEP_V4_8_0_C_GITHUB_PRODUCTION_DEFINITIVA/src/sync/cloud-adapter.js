export class CloudAdapter{
  get name(){return 'ABSTRACT'}
  get mode(){return 'ABSTRACT'}
  capabilities(){return {connect:false,push:false,pull:false,subscribe:false,batch:false}}
  async connect(_options={}){throw new Error('CloudAdapter.connect() no implementado')}
  async disconnect(){throw new Error('CloudAdapter.disconnect() no implementado')}
  async health(){return {connected:false,provider:this.name,mode:this.mode}}
  async push(_change){throw new Error('CloudAdapter.push() no implementado')}
  async pushBatch(changes=[]){const results=[];for(const change of changes)results.push(await this.push(change));return results}
  async pullSince(_domain,_cursor=null,_limit=500){throw new Error('CloudAdapter.pullSince() no implementado')}
  subscribe(_domain,_onChange,_onError=()=>{}){throw new Error('CloudAdapter.subscribe() no implementado')}
}
