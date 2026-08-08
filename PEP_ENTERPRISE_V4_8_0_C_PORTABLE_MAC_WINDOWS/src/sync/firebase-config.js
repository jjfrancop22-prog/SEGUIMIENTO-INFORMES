const STORAGE_KEY='pep.firebase.config.v1';
const DEFAULT_NAMESPACE='pep-v4';
const LEGACY_NAMESPACE='pep';

export function normalizeFirebaseConfig(input={}){
  const src=input&&typeof input==='object'?input:{};
  return {
    apiKey:String(src.apiKey||'').trim(),
    authDomain:String(src.authDomain||'').trim(),
    projectId:String(src.projectId||'').trim(),
    storageBucket:String(src.storageBucket||'').trim(),
    messagingSenderId:String(src.messagingSenderId||'').trim(),
    appId:String(src.appId||'').trim(),
    measurementId:String(src.measurementId||'').trim(),
    namespace:String(src.namespace||DEFAULT_NAMESPACE).trim().replace(/[^A-Za-z0-9_-]/g,'_')||DEFAULT_NAMESPACE
  };
}

export function firebaseConfigComplete(config={}){
  const c=normalizeFirebaseConfig(config);
  return !!(c.apiKey&&c.projectId&&c.appId);
}

export function loadFirebaseConfig(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    const c=normalizeFirebaseConfig(raw);
    // V4.0.2-B: migrate only the legacy PEP namespace to the clean V4 namespace.
    // Firebase credentials are preserved; no remote data is modified.
    if(c.namespace===LEGACY_NAMESPACE){
      c.namespace=DEFAULT_NAMESPACE;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(c));
    }
    return c;
  }catch{return normalizeFirebaseConfig({})}
}


export function saveFirebaseConfig(config){
  const c=normalizeFirebaseConfig(config);
  localStorage.setItem(STORAGE_KEY,JSON.stringify(c));
  return c;
}

export function clearFirebaseConfig(){localStorage.removeItem(STORAGE_KEY)}
export {STORAGE_KEY};
