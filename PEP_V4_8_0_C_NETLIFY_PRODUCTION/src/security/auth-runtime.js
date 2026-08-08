import {eventBus} from '../core/event-bus.js';
import {firebaseAuthProvider} from './firebase-auth-provider.js';

export const AUTH_RUNTIME_STATES=Object.freeze({
  NOT_INITIALIZED:'NOT_INITIALIZED',
  INITIALIZING:'INITIALIZING',
  SIGNED_OUT:'SIGNED_OUT',
  SIGNED_IN:'SIGNED_IN',
  TOKEN_EXPIRED:'TOKEN_EXPIRED',
  ERROR:'ERROR'
});

export class AuthRuntime{
  constructor({provider=firebaseAuthProvider,sessionManager=null,permissionManager=null}={}){
    this.provider=provider;
    this.sessions=sessionManager;
    this.permissions=permissionManager;
    this.state=AUTH_RUNTIME_STATES.NOT_INITIALIZED;
    this.ready=false;
    this.lastError=null;
    this.initializedAt=null;
    this.lastIdentityAt=null;
    this.lastTokenRefreshAt=null;
    this.unsubscribe=null;
  }
  attach({sessionManager=null,permissionManager=null}={}){
    if(sessionManager)this.sessions=sessionManager;
    if(permissionManager)this.permissions=permissionManager;
    return this;
  }
  async init(){
    if(this.ready)return this.status();
    this.state=AUTH_RUNTIME_STATES.INITIALIZING;
    this.lastError=null;
    if(this.unsubscribe){try{this.unsubscribe()}catch{}this.unsubscribe=null}
    this.unsubscribe=this.provider.onIdentityChanged(identity=>{this._applyIdentity(identity).catch(e=>this._fail(e))});
    const st=await this.provider.init();
    this.ready=!!st.ready;
    this.initializedAt=new Date().toISOString();
    this.lastError=st.lastError||null;
    if(!this.ready){
      this.state=this.lastError?AUTH_RUNTIME_STATES.ERROR:AUTH_RUNTIME_STATES.SIGNED_OUT;
      this.sessions?.clearAuthenticatedIdentity({preserveLegacy:true});
      eventBus.emit('security:auth-runtime',this.status());
      return this.status();
    }
    if(st.authenticated&&st.user)await this._applyIdentity(st.user);
    else{
      this.state=AUTH_RUNTIME_STATES.SIGNED_OUT;
      this.sessions?.clearAuthenticatedIdentity({preserveLegacy:true});
      this.permissions?.setIdentityContext?.(this.sessions?.current?.()||null);
    }
    eventBus.emit('security:auth-runtime',this.status());
    return this.status();
  }
  async _applyIdentity(identity){
    this.lastIdentityAt=new Date().toISOString();
    if(identity?.uid){
      this.state=AUTH_RUNTIME_STATES.SIGNED_IN;
      this.sessions?.setAuthenticatedIdentity({...identity,provider:this.provider.name});
      const token=await this.provider.tokenInfo().catch(()=>null);
      if(token)this.sessions?.setTokenMetadata(token);
    }else{
      this.state=AUTH_RUNTIME_STATES.SIGNED_OUT;
      this.sessions?.clearAuthenticatedIdentity({preserveLegacy:true});
    }
    this.permissions?.setIdentityContext?.(this.sessions?.current?.()||null);
    this.lastError=null;
    eventBus.emit('security:auth-runtime',this.status());
    eventBus.emit('security:auth-state',this.status());
    return this.status();
  }
  _fail(error){
    this.lastError=String(error?.message||error);
    this.state=AUTH_RUNTIME_STATES.ERROR;
    eventBus.emit('security:auth-runtime',this.status());
    return this.status();
  }
  async signInWithEmailPassword(email,password){
    try{
      if(!this.ready)await this.init();
      const identity=await this.provider.signIn({email,password});
      await this._applyIdentity(identity);
      return this.sessions?.current?.()||identity;
    }catch(e){this._fail(e);throw e}
  }
  async signOut(){
    try{
      await this.provider.signOut();
      await this._applyIdentity(null);
      return true;
    }catch(e){this._fail(e);throw e}
  }
  async refreshToken(){
    try{
      const identity=await this.provider.refreshIdentity?.(true);
      if(identity?.uid)this.sessions?.setAuthenticatedIdentity({...identity,provider:this.provider.name});
      else await this.provider.refreshIdToken();
      this.lastTokenRefreshAt=new Date().toISOString();
      const info=await this.provider.tokenInfo().catch(()=>null);
      if(info)this.sessions?.setTokenMetadata(info);
      this.permissions?.setIdentityContext?.(this.sessions?.current?.()||null);
      this.state=this.sessions?.isAuthenticated?.()?AUTH_RUNTIME_STATES.SIGNED_IN:AUTH_RUNTIME_STATES.SIGNED_OUT;
      eventBus.emit('security:auth-runtime',this.status());
      return this.sessions?.current?.()||identity||null;
    }catch(e){
      this.lastError=String(e?.message||e);
      this.state=AUTH_RUNTIME_STATES.TOKEN_EXPIRED;
      eventBus.emit('security:auth-runtime',this.status());
      throw e;
    }
  }
  async tokenInfo(){return this.provider.tokenInfo().catch(()=>null)}
  status(){
    const p=this.provider.status();
    const s=this.sessions?.current?.()||null;
    return {
      ready:this.ready,
      state:this.state,
      provider:p.provider||this.provider.name,
      authenticated:!!s?.authenticated,
      uid:s?.uid||null,
      email:s?.email||null,
      role:s?.role||'LOCAL_LEGACY',
      roleSource:s?.roleSource||'FALLBACK_LOCAL_LEGACY',
      roleClaimRaw:s?.roleClaimRaw??null,
      claims:{...(s?.claims||{})},
      deviceId:s?.deviceId||null,
      initializedAt:this.initializedAt,
      lastIdentityAt:this.lastIdentityAt,
      lastTokenRefreshAt:this.lastTokenRefreshAt,
      lastError:this.lastError||p.lastError||null,
      enforcement:false
    };
  }
}
