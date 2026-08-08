import {eventBus} from '../core/event-bus.js';
import {permissionEngine} from './permission-engine.js';
import {sessionManager} from './session-manager.js';
import {AuthRuntime} from './auth-runtime.js';

export const SECURITY_MODE='PERMISSION_ENFORCEMENT_ACTIVE';
export const AUTH_ENFORCEMENT=true;
export class SecurityManager{
  constructor(){
    this.permissions=permissionEngine;
    this.sessions=sessionManager;
    this.authRuntime=new AuthRuntime({sessionManager:this.sessions,permissionManager:this.permissions});
    this.authentication=this.authRuntime;
    this.ready=false;
  }
  async init(){
    await this.permissions.init();
    await this.sessions.init();
    this.permissions.setIdentityContext(this.sessions.current());
    await this.authRuntime.init();
    this.ready=true;
    eventBus.emit('security:ready',this.status());
    return this;
  }
  status(){
    const session=this.sessions.current(),auth=this.authRuntime.status();
    const rr=this.permissions.roleResolution?.()||{};
    return {ready:this.ready,mode:SECURITY_MODE,enforcement:AUTH_ENFORCEMENT,authenticationProvider:auth.provider||'FIREBASE_AUTH',authState:auth.state,authProviderReady:auth.ready,authenticated:!!session?.authenticated,role:session?.role||'LOCAL_LEGACY',roleSource:session?.roleSource||rr.source||'FALLBACK_LOCAL_LEGACY',roleClaimRaw:session?.roleClaimRaw??rr.raw??null,uid:session?.uid||null,deviceId:session?.deviceId||null,roleCount:this.permissions.listRoles().length,effectivePermissionCount:this.permissions.effectivePermissions(session?.role||'LOCAL_LEGACY').size,firestoreRulesChanged:true,rulesValidationOnly:false,rulesReadyForDeploy:true,rulesDeployed:false,liveSyncChanged:false,lastAuthError:auth.lastError||null};
  }
  authorize(permission){
    const session=this.sessions.current();
    const wouldAllow=this.permissions.can(session?.role||'LOCAL_LEGACY',permission);
    const authenticated=!!session?.authenticated;const claimedRole=!!session?.role&&session.role!=='LOCAL_LEGACY';
    const allowed=AUTH_ENFORCEMENT?(authenticated&&claimedRole&&wouldAllow):true;
    return {allowed,wouldAllow,enforced:AUTH_ENFORCEMENT,permission,role:session?.role||'LOCAL_LEGACY',authenticated,claimedRole};
  }
  futureIdentityContract(){return {required:['uid','role'],optional:['email','displayName','photoURL','emailVerified','claims','provider','deviceId','tokenIssuedAt','tokenExpiresAt','lastLoginAt'],provider:'FIREBASE_AUTH',states:['SIGNED_OUT','SIGNED_IN','TOKEN_EXPIRED','ERROR'],enforcementCurrently:true}}
}
export const securityManager=new SecurityManager();
