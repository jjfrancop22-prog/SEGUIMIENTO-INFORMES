import {CloudAdapter} from './cloud-adapter.js';
import {getDeviceId} from '../core/device.js';
import {loadFirebaseConfig,saveFirebaseConfig,clearFirebaseConfig,firebaseConfigComplete,normalizeFirebaseConfig} from './firebase-config.js';

const SDK_VERSION='12.16.0';
const CONNECTION_PERSIST_KEY='pep.firebase.connection.autoreconnect.v1';
let sdkPromise=null;
async function loadSdk(){
  if(sdkPromise)return sdkPromise;
  sdkPromise=(async()=>{
    const app=await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
    const fs=await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`);
    return {...app,...fs};
  })();
  return sdkPromise;
}

const safe=v=>v===undefined?null:v;
const deepClean=v=>{
  if(v===undefined)return null;
  if(v===null||typeof v!=='object')return v;
  if(v instanceof Date)return v.toISOString();
  if(Array.isArray(v))return v.map(deepClean);
  const out={};for(const [k,x] of Object.entries(v)){if(x!==undefined)out[k]=deepClean(x)}return out;
};

const asMillis=v=>{
  if(v==null)return 0;
  if(typeof v==='number')return v;
  if(typeof v?.toMillis==='function')return v.toMillis();
  const d=new Date(v);return Number.isFinite(d.getTime())?d.getTime():0;
};

const fromFirestore=v=>{
  if(v==null)return v;
  if(typeof v?.toDate==='function')return v.toDate().toISOString();
  if(Array.isArray(v))return v.map(fromFirestore);
  if(typeof v==='object'){const out={};for(const [k,x] of Object.entries(v))out[k]=fromFirestore(x);return out}
  return v;
};

export class FirebaseCloudAdapter extends CloudAdapter{
  constructor(config=null){
    super();this.config=normalizeFirebaseConfig(config||loadFirebaseConfig());this.app=null;this.db=null;this.sdk=null;this.connected=false;this.lastError=null;this.connectedAt=null;this.connectPromise=null;this.desiredConnected=localStorage.getItem(CONNECTION_PERSIST_KEY)==='1';
  }
  get name(){return 'FIREBASE_FIRESTORE'}
  get mode(){return firebaseConfigComplete(this.config)?(this.connected?'FIREBASE_CONNECTED':'FIREBASE_CONFIGURED'):'FIREBASE_UNCONFIGURED'}
  capabilities(){return {connect:true,push:true,pull:true,subscribe:true,batch:true,diagnostics:true}}
  getConfig(){return {...this.config}}
  setConfig(config,{persist=true}={}){this.config=normalizeFirebaseConfig(config);if(persist)saveFirebaseConfig(this.config);return this.getConfig()}
  clearConfig(){clearFirebaseConfig();localStorage.removeItem(CONNECTION_PERSIST_KEY);this.desiredConnected=false;this.connected=false;this.config=normalizeFirebaseConfig({});this.app=null;this.db=null;this.sdk=null;this.connectPromise=null}
  entityCollection(domain){return `${this.config.namespace}_${String(domain).toLowerCase()}`}
  changeCollection(domain){return `${this.config.namespace}_changes_${String(domain).toLowerCase()}`}
  diagnosticCollection(){return `${this.config.namespace}_diagnostics`}
  systemCollection(){return `${this.config.namespace}_system`}
  seedManifestRef(){return this.sdk.doc(this.db,this.systemCollection(),'initial_cloud_seed')}
  async getSeedManifest(){this.ensureConnected();const snap=await this.sdk.getDoc(this.seedManifestRef());return snap.exists()?snap.data():null}
  async writeSeedManifest(data={}){this.ensureConnected();const payload=deepClean({...data,projectId:this.config.projectId,namespace:this.config.namespace,updatedAt:new Date().toISOString()});payload.cloudUpdatedAt=this.sdk.serverTimestamp();await this.sdk.setDoc(this.seedManifestRef(),payload,{merge:true});return true}
  async countEntities(domain){this.ensureConnected();const c=this.sdk.collection(this.db,this.entityCollection(domain));if(this.sdk.getCountFromServer){const r=await this.sdk.getCountFromServer(c);return Number(r.data().count||0)}const s=await this.sdk.getDocs(c);return s.size}
  async fetchDomainPage(domain,{afterId=null,limitCount=250}={}){
    this.ensureConnected();
    const s=this.sdk,col=s.collection(this.db,this.entityCollection(domain)),limitN=Math.max(1,Math.min(450,Number(limitCount)||250));
    let q=s.query(col,s.orderBy(s.documentId(),'asc'),s.limit(limitN));
    if(afterId)q=s.query(col,s.orderBy(s.documentId(),'asc'),s.startAfter(String(afterId)),s.limit(limitN));
    const snap=await s.getDocs(q);
    const rows=snap.docs.map(d=>{const data=fromFirestore(d.data());return {...data,id:String(data?.id||d.id)}});
    const nextId=snap.docs.length?snap.docs[snap.docs.length-1].id:null;
    return {rows,nextId,hasMore:snap.size>=limitN,count:snap.size};
  }
  async seedDomain(domain,rows=[],{baselineId,batchSize=250,onProgress=()=>{}}={}){
    this.ensureConnected();const s=this.sdk;const cleanRows=(rows||[]).filter(x=>x&&x.id);const size=Math.max(1,Math.min(450,Number(batchSize)||250));let written=0;
    for(let i=0;i<cleanRows.length;i+=size){
      const chunk=cleanRows.slice(i,i+size),batch=s.writeBatch(this.db);
      for(const row of chunk){const revision=Math.max(1,Number(row.revision||0));const payload=deepClean({...row,revision,syncSchemaVersion:Number(row.syncSchemaVersion||1)});payload._sync={revision,deviceId:row.deviceId||getDeviceId(),operation:row.deleted?'DELETE':'UPSERT',clientUpdatedAt:row.updatedAt||row.createdAt||new Date().toISOString(),seeded:true,baselineId:baselineId||null,protocolVersion:1,cloudUpdatedAt:s.serverTimestamp()};batch.set(s.doc(this.db,this.entityCollection(domain),String(row.id)),payload,{merge:false})}
      await batch.commit();written+=chunk.length;onProgress({phase:'BATCH',domain:String(domain).toUpperCase(),done:written,total:cleanRows.length,batchSize:chunk.length});
    }
    return {domain:String(domain).toUpperCase(),written,total:cleanRows.length};
  }
  async connect(options={}){
    if(options?.config)this.setConfig(options.config,{persist:options.persist!==false});
    if(!firebaseConfigComplete(this.config))throw new Error('Firebase no está configurado. Complete apiKey, projectId y appId.');
    if(this.connected&&this.db&&this.sdk){
      this.desiredConnected=true;localStorage.setItem(CONNECTION_PERSIST_KEY,'1');
      return {connected:true,provider:this.name,mode:this.mode,projectId:this.config.projectId,namespace:this.config.namespace,reused:true};
    }
    if(this.connectPromise)return this.connectPromise;
    this.connectPromise=(async()=>{
      try{
        this.sdk=await loadSdk();
        const existing=this.sdk.getApps().find(a=>a.name==='PEP_FIREBASE')||null;
        this.app=existing||this.sdk.initializeApp({
          apiKey:this.config.apiKey,authDomain:this.config.authDomain||undefined,projectId:this.config.projectId,
          storageBucket:this.config.storageBucket||undefined,messagingSenderId:this.config.messagingSenderId||undefined,
          appId:this.config.appId,measurementId:this.config.measurementId||undefined
        },'PEP_FIREBASE');
        this.db=this.sdk.getFirestore(this.app);
        await this.sdk.enableNetwork(this.db);
        this.connected=true;this.desiredConnected=true;localStorage.setItem(CONNECTION_PERSIST_KEY,'1');this.connectedAt=new Date().toISOString();this.lastError=null;
        return {connected:true,provider:this.name,mode:this.mode,projectId:this.config.projectId,namespace:this.config.namespace,reused:false};
      }catch(e){this.connected=false;this.lastError=String(e?.message||e);throw e}
      finally{this.connectPromise=null}
    })();
    return this.connectPromise;
  }
  async restoreConnection(){
    if(this.connected&&this.db&&this.sdk)return this.health();
    if(!this.desiredConnected||!firebaseConfigComplete(this.config))return this.health();
    try{await this.connect();return this.health()}catch(e){this.lastError=String(e?.message||e);return this.health()}
  }
  async disconnect(){
    try{if(this.db&&this.sdk)await this.sdk.disableNetwork(this.db)}catch{}
    this.connected=false;this.desiredConnected=false;localStorage.removeItem(CONNECTION_PERSIST_KEY);return {connected:false,provider:this.name,mode:this.mode};
  }
  isConnected(){return !!(this.connected&&this.db&&this.sdk)}
  async health(){return {connected:this.isConnected(),configured:firebaseConfigComplete(this.config),provider:this.name,mode:this.mode,projectId:this.config.projectId||null,namespace:this.config.namespace,lastError:this.lastError,connectedAt:this.connectedAt,desiredConnected:this.desiredConnected,capabilities:this.capabilities()}}
  ensureConnected(){if(!this.isConnected())throw new Error('Firebase Adapter no conectado. Use Sistema → Sincronización → Conectar Firebase.')}
  async push(change){
    this.ensureConnected();
    const s=this.sdk,entityId=String(change.entityId||change.payload?.id||'');if(!entityId)throw new Error('Cambio sin entityId');
    const domain=String(change.domain||'').toUpperCase();if(!domain)throw new Error('Cambio sin domain');
    const entityRef=s.doc(this.db,this.entityCollection(domain),entityId),changeRef=s.doc(s.collection(this.db,this.changeCollection(domain)));
    const incomingRev=Number(change.revision||change.payload?.revision||1),payload={...(change.payload||{}),id:entityId,revision:incomingRev,syncSchemaVersion:Number(change.payload?.syncSchemaVersion||1)};
    return s.runTransaction(this.db,async tx=>{
      const snap=await tx.get(entityRef);const current=snap.exists()?snap.data():null;const cloudRev=Number(current?._sync?.revision||current?.revision||0);
      const cloudUpdated=String(current?.updatedAt||''),incomingUpdated=String(payload.updatedAt||change.updatedAt||change.createdAt||'');
      if(cloudRev>incomingRev||(cloudRev===incomingRev&&cloudUpdated>incomingUpdated))return {accepted:false,reason:'CLOUD_NEWER',cloudRevision:cloudRev};
      const syncMeta={revision:incomingRev,deviceId:change.deviceId||getDeviceId(),operation:change.operation||'UPSERT',clientUpdatedAt:incomingUpdated||new Date().toISOString(),cloudUpdatedAt:s.serverTimestamp(),protocolVersion:1};
      tx.set(entityRef,{...payload,_sync:syncMeta},{merge:false});
      tx.set(changeRef,{domain,entityId,entityType:change.entityType||domain,operation:change.operation||'UPSERT',revision:incomingRev,payload,deviceId:change.deviceId||getDeviceId(),clientUpdatedAt:incomingUpdated||new Date().toISOString(),cloudUpdatedAt:s.serverTimestamp()});
      return {accepted:true,entityId,revision:incomingRev};
    });
  }
  async pushBatch(changes=[]){const results=[];for(const change of changes)results.push(await this.push(change));return results}
  async pullSince(domain,cursor=null,limitCount=500){
    this.ensureConnected();const s=this.sdk;const col=s.collection(this.db,this.changeCollection(domain));
    let q=s.query(col,s.orderBy('cloudUpdatedAt','asc'),s.orderBy(s.documentId(),'asc'),s.limit(Number(limitCount)||500));
    if(cursor?.timestampMillis&&cursor?.docId)q=s.query(col,s.orderBy('cloudUpdatedAt','asc'),s.orderBy(s.documentId(),'asc'),s.startAfter(s.Timestamp.fromMillis(Number(cursor.timestampMillis)),String(cursor.docId)),s.limit(Number(limitCount)||500));
    const snap=await s.getDocs(q),changes=[];let next=cursor;
    for(const d of snap.docs){const x=d.data(),ms=asMillis(x.cloudUpdatedAt);changes.push({...x,id:d.id,cloudUpdatedAt:ms?new Date(ms).toISOString():null});next={timestampMillis:ms||Date.now(),docId:d.id}}
    return {changes,cursor:next,hasMore:snap.size>=(Number(limitCount)||500)};
  }
  subscribe(domain,onChange,onError=()=>{},{cursor=null}={}){
    this.ensureConnected();
    const s=this.sdk,col=s.collection(this.db,this.changeCollection(domain));
    let q;
    if(cursor?.timestampMillis&&cursor?.docId){
      // Cursor real: cloudUpdatedAt + documentId() como desempate estable.
      // Para orderBy(documentId()) Firestore Web SDK espera el ID como string
      // en startAfter(), no un DocumentReference/DocumentSnapshot.
      q=s.query(
        col,
        s.orderBy('cloudUpdatedAt','asc'),
        s.orderBy(s.documentId(),'asc'),
        s.startAfter(s.Timestamp.fromMillis(Number(cursor.timestampMillis)),String(cursor.docId))
      );
    }else{
      // Primer arranque: todavía no existe docId de cursor. No combinar documentId()
      // con un startAt parcial; esa combinación provocaba el error de path impar.
      // Se deja un pequeño solapamiento para cerrar la ventana pull -> listener;
      // applyRemote() es idempotente por revisión y no genera eco.
      const from=s.Timestamp.fromMillis(Date.now()-5000);
      q=s.query(col,s.orderBy('cloudUpdatedAt','asc'),s.startAt(from));
    }
    return s.onSnapshot(q,snap=>{
      for(const ch of snap.docChanges()){
        if(ch.type==='added'){
          const x=ch.doc.data(),ms=asMillis(x.cloudUpdatedAt),c={timestampMillis:ms||Date.now(),docId:ch.doc.id};
          onChange({...x,id:ch.doc.id,cloudUpdatedAt:ms?new Date(ms).toISOString():null,_cursor:c});
        }
      }
    },onError);
  }
  async testConnection({write=false}={}){
    this.ensureConnected();const s=this.sdk,ref=s.doc(this.db,this.diagnosticCollection(),`device_${getDeviceId()}`);
    try{
      if(write){await s.setDoc(ref,{deviceId:getDeviceId(),testedAt:s.serverTimestamp(),app:'PEP V4.2.0',purpose:'CONNECTION_DIAGNOSTIC'});const snap=await s.getDoc(ref);await s.deleteDoc(ref);return {ok:true,write:true,read:snap.exists(),projectId:this.config.projectId}}
      const snap=await s.getDoc(ref);return {ok:true,write:false,read:snap.exists(),projectId:this.config.projectId};
    }catch(e){this.lastError=String(e?.message||e);return {ok:false,write,error:this.lastError,projectId:this.config.projectId}}
  }
}

export const firebaseCloudAdapterSingleton=new FirebaseCloudAdapter();
