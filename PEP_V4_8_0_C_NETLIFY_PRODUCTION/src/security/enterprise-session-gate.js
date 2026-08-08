import {eventBus} from '../core/event-bus.js';
import {SESSION_WARN_MS} from './session-manager.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtLeft=ms=>{const sec=Math.max(0,Math.ceil(ms/1000)),m=Math.floor(sec/60),s=sec%60;return `${m}:${String(s).padStart(2,'0')}`};

export class EnterpriseSessionGate{
  constructor({securityManager,liveController=null,toast=()=>{},onAuthenticated=null,onLocked=null}={}){
    this.security=securityManager;this.live=liveController;this.toast=toast;this.onAuthenticated=onAuthenticated;this.onLocked=onLocked;
    this.unlocked=false;this.revalidating=false;this.bound=false;
  }
  sessions(){return this.security.sessions}
  roleIsValid(session){return !!(session?.authenticated&&session?.uid&&session?.role&&session.role!=='LOCAL_LEGACY'&&session.roleSource!=='FALLBACK_LOCAL_LEGACY')}
  async init(){
    document.body.classList.add('enterprise-locked');this.bind();
    const session=this.sessions().current();
    if(this.roleIsValid(session)&&this.sessions().enterpriseSessionValid(session))await this.unlock({restoreLive:true,announce:false,preserveMarker:true});
    else{
      this.sessions().endEnterpriseSession();
      if(session?.authenticated)await this.security.authRuntime.signOut().catch(()=>{});
      await this.lock('Ingrese sus credenciales para acceder al ERP.');
    }
    return this.status();
  }
  bind(){
    if(this.bound)return;this.bound=true;
    $('enterpriseLoginForm')?.addEventListener('submit',e=>{e.preventDefault();this.login()});
    $('enterpriseLogout')?.addEventListener('click',()=>this.logout('Sesión cerrada.'));
    $('enterpriseHeaderLogout')?.addEventListener('click',()=>this.logout('Sesión cerrada.'));
    eventBus.on('security:auth-state',ev=>{const state=ev?.detail||{};if(this.unlocked&&state.state==='SIGNED_OUT'){this.sessions().endEnterpriseSession();this.lock('La sesión de Firebase fue cerrada. Inicie sesión nuevamente.')}});
    eventBus.on('security:session-activity',()=>{if(this.unlocked)this.renderSessionMeta()});
    eventBus.on('security:session-tick',ev=>{if(this.unlocked)this.onTick(ev?.detail||{})});
    eventBus.on('security:session-expired',()=>{if(this.unlocked)this.expire()});
    eventBus.on('security:session-revalidate-needed',()=>{if(this.unlocked)this.revalidate()});
  }
  async login(){
    const email=$('enterpriseLoginEmail')?.value.trim()||'',password=$('enterpriseLoginPassword')?.value||'';
    const btn=$('enterpriseLoginSubmit');this.error('');
    if(!email||!password){this.error('Ingrese correo electrónico y contraseña.');return}
    if(btn){btn.disabled=true;btn.textContent='Verificando…'}
    try{
      await this.security.authRuntime.signInWithEmailPassword(email,password);await this.security.authRuntime.refreshToken();
      const s=this.sessions().current();if(!this.roleIsValid(s))throw new Error('El usuario no tiene un rol autorizado en Firebase. Contacte al administrador.');
      this.sessions().beginEnterpriseSession(s);if($('enterpriseLoginPassword'))$('enterpriseLoginPassword').value='';
      await this.unlock({restoreLive:true,announce:true,preserveMarker:true});
    }catch(e){
      await this.security.authRuntime.signOut().catch(()=>{});this.sessions().endEnterpriseSession();
      const code=String(e?.code||''),map={'auth/invalid-credential':'Usuario o contraseña incorrectos.','auth/user-disabled':'Usuario suspendido. Contacte al administrador.','auth/too-many-requests':'Demasiados intentos. Espere antes de volver a intentar.','auth/network-request-failed':'No fue posible validar la sesión. Revise Internet.'};
      this.error(map[code]||String(e?.message||e));
    }finally{if(btn){btn.disabled=false;btn.textContent='Iniciar sesión'}}
  }
  async unlock({restoreLive=true,announce=false,preserveMarker=false}={}){
    const s=this.sessions().current();if(!this.roleIsValid(s)){await this.lock('Acceso denegado: rol no válido.');return false}
    this.unlocked=true;if(!preserveMarker)this.sessions().beginEnterpriseSession(s);else this.sessions().enterpriseActive=true;
    document.body.classList.remove('enterprise-locked');document.body.classList.add('enterprise-authenticated');$('enterpriseLoginGate')?.classList.remove('show');this.renderSessionMeta();
    if(this.onAuthenticated)await this.onAuthenticated({restoreLive});else if(restoreLive&&this.live)await this.live.restoreConfigured().catch(e=>this.toast(`Live Sync: ${e.message||e}`,true));
    if(announce)this.toast(`Bienvenido · ${s.displayName||s.email} · ${s.role}`);return true;
  }
  async lock(message='Sesión requerida.'){
    this.unlocked=false;if(this.onLocked)await this.onLocked().catch(()=>{});document.body.classList.add('enterprise-locked');document.body.classList.remove('enterprise-authenticated');
    $('enterpriseLoginGate')?.classList.add('show');this.renderSessionMeta();this.error(message==='Ingrese sus credenciales para acceder al ERP.'?'':message);return true;
  }
  async logout(message='Sesión finalizada.'){
    if(this.onLocked)await this.onLocked().catch(()=>{});else if(this.live)await this.live.stopAll({manual:false}).catch(()=>{});
    this.sessions().endEnterpriseSession();await this.security.authRuntime.signOut().catch(()=>{});await this.lock();this.error('');this.toast(message);
  }
  async expire(){if(!this.unlocked)return;await this.logout('Sesión cerrada por 30 minutos de inactividad.');this.error('La sesión venció por inactividad. Inicie sesión nuevamente.')}
  async revalidate(){
    if(this.revalidating||!this.unlocked)return;this.revalidating=true;
    try{await this.security.authRuntime.refreshToken();const s=this.sessions().current();if(!this.roleIsValid(s))throw new Error('ROL_INVALIDO');this.renderSessionMeta()}
    catch{await this.logout('La sesión ya no es válida o el usuario fue suspendido.');this.error('Su sesión fue revocada o la cuenta fue suspendida. Inicie sesión nuevamente.')}
    finally{this.revalidating=false}
  }
  onTick(status){const left=Number(status.remainingMs||0),warn=$('enterpriseSessionWarning');if(warn){warn.style.display=left<=SESSION_WARN_MS?'block':'none';warn.textContent=left<=SESSION_WARN_MS?`⚠ La sesión se cerrará en ${fmtLeft(left)} por inactividad.`:''}this.renderSessionMeta(left)}
  renderSessionMeta(left=null){
    const s=this.sessions().current();if(left==null)left=this.sessions().enterpriseRemainingMs();
    if($('enterpriseHeaderUser'))$('enterpriseHeaderUser').textContent=s?.authenticated?(s.displayName||s.email||'Usuario'):'—';
    if($('enterpriseHeaderRole'))$('enterpriseHeaderRole').textContent=s?.authenticated?(s.role||'—'):'—';
    if($('enterpriseHeaderTimer'))$('enterpriseHeaderTimer').textContent=this.unlocked?fmtLeft(left):'—';
    const meta=$('enterpriseLoginMeta');if(meta&&s?.authenticated)meta.innerHTML=`<b>${esc(s.displayName||s.email)}</b> · ${esc(s.role)} · <span class="mono">${esc(s.uid)}</span>`;
  }
  error(message){const el=$('enterpriseLoginError');if(!el)return;el.textContent=message||'';el.style.display=message?'block':'none'}
  status(){const s=this.sessions().current(),st=this.sessions().enterpriseStatus();return {unlocked:this.unlocked,uid:s?.uid||null,role:s?.role||null,lastActivityAt:st.lastActivityAt,idleTimeoutMinutes:30}}
}
