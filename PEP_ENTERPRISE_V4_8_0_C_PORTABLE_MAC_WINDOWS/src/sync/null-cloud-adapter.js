import {CloudAdapter} from './cloud-adapter.js';
export class NullCloudAdapter extends CloudAdapter{
  get name(){return 'NONE'}
  get mode(){return 'FOUNDATION_LOCAL_ONLY'}
  capabilities(){return {connect:false,push:false,pull:false,subscribe:false,batch:false}}
  async connect(){return {connected:false,provider:this.name,mode:this.mode}}
  async disconnect(){return true}
  async health(){return {connected:false,provider:this.name,mode:this.mode,ready:true,reason:'Firebase todavía no configurado'}}
  async push(){return {skipped:true,reason:'LOCAL_ONLY'}}
  async pushBatch(changes=[]){return changes.map(()=>({skipped:true,reason:'LOCAL_ONLY'}))}
  async pullSince(domain,cursor=null){return {domain,changes:[],cursor,hasMore:false}}
  subscribe(){return ()=>{}}
}
