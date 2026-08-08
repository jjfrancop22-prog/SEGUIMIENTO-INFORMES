import {getDeviceId} from '../core/device.js';
import {eventBus} from '../core/event-bus.js';

const KEY='pep_security_session_v2';
const ENTERPRISE_KEY='pep_enterprise_gate_session_v1';
export const SESSION_IDLE_MS=30*60*1000;
export const SESSION_WARN_MS=2*60*1000;
export const SESSION_REVALIDATE_MS=5*60*1000;
function nowIso(){return new Date().toISOString()}
function nowMs(){return Date.now()}
function safeParse(v){try{return JSON.parse(v)}catch{return null}}

export class SessionManager{
  constructor(){
    this.session=null;this.activityTimer=null;this.activityBound=false;this.enterpriseActive=false;this.lastRevalidateSignalAt=0;
    this.activityHandler=()=>this.touchEnterpriseActivity();
  }
  async init(){
    const saved=safeParse(sessionStorage.getItem(KEY));
    if(saved?.deviceId===getDeviceId())this.session=saved;
    if(!this.session)this.session=this.createPreAuthSession();
    this.persist();this.bindActivity();this.startActivityMonitor();return this;
  }
  createPreAuthSession(){return {mode:'PRE_AUTH',authenticated:false,uid:null,email:null,displayName:'Sesión local',photoURL:null,emailVerified:false,role:'LOCAL_LEGACY',roleSource:'FALLBACK_LOCAL_LEGACY',roleClaimRaw:null,deviceId:getDeviceId(),issuedAt:nowIso(),lastValidatedAt:nowIso(),lastLoginAt:null,provider:'NONE',claims:{},tokenIssuedAt:null,tokenExpiresAt:null}}
  current(){return this.session?{...this.session,claims:{...(this.session.claims||{})}}:null}
  isAuthenticated(){return !!this.session?.authenticated}
  setAuthenticatedIdentity(identity={}){
    this.session={...this.session,mode:'AUTHENTICATED',authenticated:true,uid:identity.uid||null,email:identity.email||null,displayName:identity.displayName||identity.email||'Usuario',photoURL:identity.photoURL||null,role:identity.role||'LOCAL_LEGACY',roleSource:identity.roleSource||'FALLBACK_LOCAL_LEGACY',roleClaimRaw:identity.roleClaimRaw??null,provider:identity.provider||'FIREBASE_AUTH',claims:{...(identity.claims||{})},emailVerified:!!identity.emailVerified,lastLoginAt:identity.lastLoginAt||this.session?.lastLoginAt||nowIso(),lastValidatedAt:nowIso()};
    this.persist();eventBus.emit('security:session-changed',this.current());return this.current();
  }
  setTokenMetadata({issuedAtTime=null,expirationTime=null}={}){if(this.session){this.session.tokenIssuedAt=issuedAtTime;this.session.tokenExpiresAt=expirationTime;this.session.lastValidatedAt=nowIso();this.persist()}return this.current()}
  clearAuthenticatedIdentity({preserveLegacy=true}={}){this.endEnterpriseSession();this.session=this.createPreAuthSession();if(!preserveLegacy)this.session.role='CONSULTA';this.persist();eventBus.emit('security:session-changed',this.current());return this.current()}
  touch(){if(this.session){this.session.lastValidatedAt=nowIso();this.persist()}return this.current()}
  persist(){sessionStorage.setItem(KEY,JSON.stringify(this.session))}

  enterpriseMarker(){return safeParse(sessionStorage.getItem(ENTERPRISE_KEY))}
  enterpriseSessionValid(session=this.current()){
    const m=this.enterpriseMarker();
    return !!(m&&session?.uid&&m.uid===session.uid&&nowMs()-Number(m.lastActivityAt||0)<SESSION_IDLE_MS);
  }
  beginEnterpriseSession(session=this.current()){
    if(!session?.uid)return null;
    const old=this.enterpriseMarker();
    const marker={uid:session.uid,lastActivityAt:nowMs(),openedAt:old?.uid===session.uid?(old.openedAt||nowMs()):nowMs()};
    sessionStorage.setItem(ENTERPRISE_KEY,JSON.stringify(marker));this.enterpriseActive=true;this.lastRevalidateSignalAt=nowMs();
    eventBus.emit('security:enterprise-session-started',this.enterpriseStatus());return marker;
  }
  endEnterpriseSession(){sessionStorage.removeItem(ENTERPRISE_KEY);this.enterpriseActive=false;eventBus.emit('security:enterprise-session-ended',{});return true}
  touchEnterpriseActivity(){
    if(!this.enterpriseActive)return null;const s=this.current();if(!s?.authenticated||!s.uid)return null;
    const m=this.enterpriseMarker();if(!m||m.uid!==s.uid)return null;
    m.lastActivityAt=nowMs();sessionStorage.setItem(ENTERPRISE_KEY,JSON.stringify(m));
    eventBus.emit('security:session-activity',this.enterpriseStatus());return m;
  }
  enterpriseRemainingMs(){const m=this.enterpriseMarker();return m?SESSION_IDLE_MS-(nowMs()-Number(m.lastActivityAt||0)):0}
  enterpriseStatus(){const m=this.enterpriseMarker();return {active:this.enterpriseActive,uid:m?.uid||null,lastActivityAt:m?.lastActivityAt||null,remainingMs:this.enterpriseRemainingMs(),idleTimeoutMinutes:30}}
  bindActivity(){
    if(this.activityBound)return;this.activityBound=true;
    ['pointerdown','keydown','touchstart','input'].forEach(type=>document.addEventListener(type,this.activityHandler,{passive:true}));
  }
  startActivityMonitor(){
    if(this.activityTimer)return;
    this.activityTimer=setInterval(()=>{
      if(!this.enterpriseActive)return;
      const status=this.enterpriseStatus();eventBus.emit('security:session-tick',status);
      if(status.remainingMs<=0){this.enterpriseActive=false;eventBus.emit('security:session-expired',status);return}
      if(nowMs()-this.lastRevalidateSignalAt>=SESSION_REVALIDATE_MS){this.lastRevalidateSignalAt=nowMs();eventBus.emit('security:session-revalidate-needed',status)}
    },1000);
  }
}
export const sessionManager=new SessionManager();
