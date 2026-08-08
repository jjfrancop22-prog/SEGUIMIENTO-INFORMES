import {loadFirebaseConfig,firebaseConfigComplete} from '../sync/firebase-config.js';

const SDK_VERSION='12.16.0';
const DEFAULT_REGION='us-central1';
let sdkPromise=null;

async function loadFunctionsSdk(){
  if(sdkPromise)return sdkPromise;
  sdkPromise=(async()=>{
    const app=await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
    const fn=await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-functions.js`);
    return {...app,...fn};
  })();
  return sdkPromise;
}

function functionsRegion(){
  return localStorage.getItem('pep_claims_functions_region')||DEFAULT_REGION;
}

export class AdminClaimsClient{
  constructor(){this.sdk=null;this.app=null;this.functions=null;this.ready=false;this.lastError=null;this.lastSuccessAt=null;}
  async init(){
    if(this.ready&&this.functions)return this.status();
    const config=loadFirebaseConfig();
    if(!firebaseConfigComplete(config)){this.lastError='Firebase Web App no configurada.';return this.status();}
    try{
      this.sdk=await loadFunctionsSdk();
      this.app=this.sdk.getApps().find(a=>a.name==='PEP_FIREBASE')||this.sdk.initializeApp({
        apiKey:config.apiKey,authDomain:config.authDomain||undefined,projectId:config.projectId,
        storageBucket:config.storageBucket||undefined,messagingSenderId:config.messagingSenderId||undefined,
        appId:config.appId,measurementId:config.measurementId||undefined
      },'PEP_FIREBASE');
      this.functions=this.sdk.getFunctions(this.app,functionsRegion());
      this.ready=true;this.lastError=null;return this.status();
    }catch(e){this.ready=false;this.lastError=String(e?.message||e);return this.status();}
  }
  setRegion(region){
    const v=String(region||'').trim()||DEFAULT_REGION;
    localStorage.setItem('pep_claims_functions_region',v);
    this.functions=null;this.ready=false;
    return v;
  }
  async _call(name,data={}){
    if(!this.ready)await this.init();
    if(!this.functions)throw new Error(this.lastError||'Firebase Functions no inicializado.');
    try{
      const callable=this.sdk.httpsCallable(this.functions,name);
      const result=await callable(data);
      this.lastError=null;this.lastSuccessAt=new Date().toISOString();
      return result?.data??null;
    }catch(e){
      this.lastError=String(e?.message||e);
      throw e;
    }
  }
  async adminStatus(){return this._call('pepClaimsAdminStatus',{});}
  async listUsers({maxResults=200}={}){
    const n=Math.max(1,Math.min(1000,Number(maxResults)||200));
    return this._call('pepListAuthUsers',{maxResults:n});
  }

  async createUser({email,password,displayName='',role='CONSULTA'}={}){return this._call('pepCreateAuthUser',{email,password,displayName,role});}
  async updateUser({uid,email,displayName}={}){return this._call('pepUpdateAuthUser',{uid,email,displayName});}
  async setDisabled({uid,email,disabled}={}){return this._call('pepSetUserDisabled',{uid,email,disabled:disabled===true});}
  async setPassword({uid,email,password,revokeSessions=true}={}){return this._call('pepSetUserPassword',{uid,email,password,revokeSessions});}
  async generateResetLink({uid,email}={}){return this._call('pepGeneratePasswordResetLink',{uid,email});}
  async assignRole({uid=null,email=null,role}={}){
    const targetUid=String(uid||'').trim();
    const targetEmail=String(email||'').trim();
    const targetRole=String(role||'').trim().toUpperCase();
    if(!targetUid&&!targetEmail)throw new Error('Ingrese UID o email del usuario destino.');
    if(!targetRole)throw new Error('Seleccione un rol.');
    return this._call('pepSetUserClaims',{uid:targetUid||null,email:targetEmail||null,role:targetRole});
  }
  status(){return {ready:this.ready,region:functionsRegion(),lastError:this.lastError,lastSuccessAt:this.lastSuccessAt};}
}

export const adminClaimsClient=new AdminClaimsClient();
