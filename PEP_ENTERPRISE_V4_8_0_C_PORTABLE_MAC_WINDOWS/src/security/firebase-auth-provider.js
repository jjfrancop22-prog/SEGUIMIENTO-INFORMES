import {AuthProvider} from './auth-provider.js';
import {loadFirebaseConfig,firebaseConfigComplete} from '../sync/firebase-config.js';
import {resolveRoleFromClaims} from './permission-engine.js';

const SDK_VERSION='12.16.0';
let sdkPromise=null;
async function loadAuthSdk(){
  if(sdkPromise)return sdkPromise;
  sdkPromise=(async()=>{
    const app=await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
    const auth=await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`);
    return {...app,...auth};
  })();
  return sdkPromise;
}
function normalizeUser(user,claims={}){
  if(!user)return null;
  const resolved=resolveRoleFromClaims(claims);
  return {
    uid:user.uid||null,email:user.email||null,displayName:user.displayName||user.email||'Usuario',
    emailVerified:!!user.emailVerified,photoURL:user.photoURL||null,lastLoginAt:user.metadata?.lastSignInTime||null,
    providerId:user.providerData?.[0]?.providerId||'firebase',claims:{...claims},
    role:resolved.role,roleSource:resolved.source,roleClaimRaw:resolved.raw
  };
}
export class FirebaseAuthProvider extends AuthProvider{
  constructor(){super();this.sdk=null;this.app=null;this.auth=null;this.ready=false;this.user=null;this.claims={};this.lastError=null;this.unsubscribe=null;this.listeners=new Set();this.initializedAt=null}
  get name(){return 'FIREBASE_AUTH'}
  get mode(){return this.ready?(this.user?'SIGNED_IN':'AUTH_READY'):'NOT_INITIALIZED'}
  async init(){
    if(this.ready&&this.auth)return this.status();
    const config=loadFirebaseConfig();
    if(!firebaseConfigComplete(config)){this.lastError='Firebase Web App no configurada.';return this.status()}
    try{
      this.sdk=await loadAuthSdk();
      this.app=this.sdk.getApps().find(a=>a.name==='PEP_FIREBASE')||this.sdk.initializeApp({apiKey:config.apiKey,authDomain:config.authDomain||undefined,projectId:config.projectId,storageBucket:config.storageBucket||undefined,messagingSenderId:config.messagingSenderId||undefined,appId:config.appId,measurementId:config.measurementId||undefined},'PEP_FIREBASE');
      this.auth=this.sdk.getAuth(this.app);
      // V4.7.0-B: persistencia de sesión únicamente durante la pestaña/ventana actual.
      // Al cerrar el navegador, Firebase no conserva una sesión permanente.
      await this.sdk.setPersistence(this.auth,this.sdk.browserSessionPersistence);
      this.ready=true;this.initializedAt=new Date().toISOString();this.lastError=null;
      if(this.unsubscribe)this.unsubscribe();
      let initialResolved=false,resolveInitial;
      const initialState=new Promise(resolve=>{resolveInitial=resolve});
      this.unsubscribe=this.sdk.onIdTokenChanged(this.auth,async user=>{
        this.user=user||null;this.claims={};
        if(user){try{const r=await this.sdk.getIdTokenResult(user,false);this.claims={...(r?.claims||{})}}catch(e){this.lastError=String(e?.message||e)}}
        const identity=this.identity();for(const cb of this.listeners){try{cb(identity)}catch{}}
        if(!initialResolved){initialResolved=true;resolveInitial?.()}
      });
      // Esperar la primera restauración de Firebase Auth evita mostrar Login falsamente en un refresh
      // de la misma pestaña cuando la sesión empresarial de 30 min todavía es válida.
      await initialState;
      return this.status();
    }catch(e){this.ready=false;this.lastError=String(e?.message||e);return this.status()}
  }
  identity(){return normalizeUser(this.user,this.claims)}
  status(){return {provider:this.name,mode:this.mode,ready:this.ready,authenticated:!!this.user,user:this.identity(),initializedAt:this.initializedAt,lastError:this.lastError}}
  onIdentityChanged(callback){this.listeners.add(callback);return ()=>this.listeners.delete(callback)}
  async signIn({email,password}={}){if(!this.ready)await this.init();if(!this.auth)throw new Error(this.lastError||'Firebase Auth no inicializado.');if(!email||!password)throw new Error('Email y contraseña son requeridos.');const result=await this.sdk.signInWithEmailAndPassword(this.auth,String(email).trim(),String(password));return normalizeUser(result.user,(await this.sdk.getIdTokenResult(result.user,false)).claims||{})}
  async signOut(){if(!this.ready||!this.auth)return true;await this.sdk.signOut(this.auth);return true}
  async getIdToken(forceRefresh=false){if(!this.user)return null;return this.sdk.getIdToken(this.user,!!forceRefresh)}
  async refreshIdToken(){return this.getIdToken(true)}
  async refreshIdentity(forceRefresh=true){
    if(!this.user)return null;
    const r=await this.sdk.getIdTokenResult(this.user,!!forceRefresh);
    this.claims={...(r?.claims||{})};
    const identity=this.identity();
    for(const cb of this.listeners){try{cb(identity)}catch{}}
    return identity;
  }
  async tokenInfo(){if(!this.user)return null;const r=await this.sdk.getIdTokenResult(this.user,false);return {issuedAtTime:r.issuedAtTime||null,expirationTime:r.expirationTime||null,signInProvider:r.signInProvider||null,claims:{...(r.claims||{})}}}
}
export const firebaseAuthProvider=new FirebaseAuthProvider();
