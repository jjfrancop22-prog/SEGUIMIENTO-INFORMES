import {DB_NAME,DB_VERSION,STORES} from './schema.js';
let dbPromise;
export function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const name of Object.values(STORES)){
        if(!db.objectStoreNames.contains(name)){
          const keyPath=['auditLog','outbox','inbox'].includes(name)?'id':'id';
          const s=db.createObjectStore(name,{keyPath});
          if(name==='outbox'){s.createIndex('status','status',{unique:false});s.createIndex('domain','domain',{unique:false});s.createIndex('createdAt','createdAt',{unique:false})}
          if(name==='inbox'){s.createIndex('processed','processed',{unique:false});s.createIndex('receivedAt','receivedAt',{unique:false})}
          if(name==='auditLog'){s.createIndex('entityId','entityId',{unique:false});s.createIndex('createdAt','createdAt',{unique:false})}
          if(name==='conflicts'){s.createIndex('status','status',{unique:false});s.createIndex('domain','domain',{unique:false});s.createIndex('entityId','entityId',{unique:false});s.createIndex('detectedAt','detectedAt',{unique:false})}
        }
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>console.warn('PEP IndexedDB upgrade bloqueado por otra pestaña');
  });
  return dbPromise;
}
export async function tx(storeNames,mode,fn){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(storeNames,mode);
    let result;
    try{result=fn(transaction)}catch(e){transaction.abort();reject(e);return}
    transaction.oncomplete=()=>resolve(result);
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error||new Error('Transacción abortada'));
  });
}
export async function put(store,value){return tx([store],'readwrite',t=>t.objectStore(store).put(value))}
export async function get(store,id){const db=await openDB();return new Promise((resolve,reject)=>{const t=db.transaction(store,'readonly'),r=t.objectStore(store).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
export async function getAll(store){const db=await openDB();return new Promise((resolve,reject)=>{const t=db.transaction(store,'readonly'),r=t.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
export async function remove(store,id){return tx([store],'readwrite',t=>t.objectStore(store).delete(id))}
export async function clearStore(store){return tx([store],'readwrite',t=>t.objectStore(store).clear())}
export async function putManyDirect(store,rows=[]){return tx([store],'readwrite',t=>{const s=t.objectStore(store);for(const row of rows)s.put(row);return rows.length})}
