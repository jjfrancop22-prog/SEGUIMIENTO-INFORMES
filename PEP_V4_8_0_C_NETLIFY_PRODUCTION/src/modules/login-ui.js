import {eventBus} from '../core/event-bus.js';
import {securityManager} from '../security/security-manager.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function friendlyAuthError(error){
  const code=String(error?.code||'');
  const raw=String(error?.message||error||'No fue posible iniciar sesión.');
  const map={
    'auth/invalid-credential':'Correo o contraseña incorrectos.',
    'auth/invalid-login-credentials':'Correo o contraseña incorrectos.',
    'auth/user-not-found':'No existe un usuario con ese correo.',
    'auth/wrong-password':'Correo o contraseña incorrectos.',
    'auth/invalid-email':'El correo electrónico no es válido.',
    'auth/user-disabled':'Esta cuenta está deshabilitada.',
    'auth/too-many-requests':'Demasiados intentos. Espere un momento antes de volver a intentar.',
    'auth/network-request-failed':'No fue posible contactar Firebase Authentication. Revise la conexión.',
    'auth/operation-not-allowed':'Email/Password todavía no está habilitado en Firebase Authentication.'
  };
  return map[code]||raw.replace(/^Firebase:\s*/,'');
}

export class LoginUI{
  constructor({onStatusChange=null}={}){this.onStatusChange=onStatusChange;this.busUnsubs=[];}
  async init(){
    const form=$('authLoginForm');
    if(form)form.addEventListener('submit',e=>{e.preventDefault();this.signIn();});
    if($('authLogout'))$('authLogout').addEventListener('click',()=>this.signOut());
    if($('authLoginRefresh'))$('authLoginRefresh').addEventListener('click',()=>this.refresh());
    this.busUnsubs.push(eventBus.on('security:auth-state',()=>this.refresh()));
    this.busUnsubs.push(eventBus.on('security:session-changed',()=>this.refresh()));
    await this.refresh();
  }
  async signIn(){
    const email=$('authLoginEmail')?.value.trim()||'';
    const password=$('authLoginPassword')?.value||'';
    const errorBox=$('authLoginError');
    if(errorBox){errorBox.textContent='';errorBox.style.display='none';}
    if(!email||!password){this.showError('Ingrese correo y contraseña.');return;}
    const btn=$('authLoginSubmit');
    if(btn){btn.disabled=true;btn.textContent='Ingresando…';}
    try{
      await securityManager.authentication.signInWithEmailPassword(email,password);
      if($('authLoginPassword'))$('authLoginPassword').value='';
      await this.refresh();
      await this.onStatusChange?.('SIGNED_IN');
    }catch(e){this.showError(friendlyAuthError(e));await this.refresh();}
    finally{if(btn){btn.disabled=false;btn.textContent='Iniciar sesión';}}
  }
  async signOut(){
    const btn=$('authLogout');
    if(btn){btn.disabled=true;btn.textContent='Cerrando…';}
    try{await securityManager.authentication.signOut();await this.refresh();await this.onStatusChange?.('SIGNED_OUT');}
    catch(e){this.showError(friendlyAuthError(e));}
    finally{if(btn){btn.disabled=false;btn.textContent='Cerrar sesión';}}
  }
  showError(message){const el=$('authLoginError');if(el){el.textContent=message;el.style.display='block';}}
  async refresh(){
    const a=securityManager.authentication.status();
    const s=securityManager.sessions.current();
    const signed=!!s?.authenticated;
    if($('authLoginStatus'))$('authLoginStatus').textContent=signed?'SESIÓN AUTENTICADA':'MODO LOCAL_LEGACY';
    if($('authLoginStatus'))$('authLoginStatus').className=`badge ${signed?'green':'amber'}`;
    if($('authLoginIdentity'))$('authLoginIdentity').innerHTML=signed
      ? `<div class="notice"><b>Sesión Firebase activa.</b> UID <span class="mono">${esc(s.uid)}</span> · ${esc(s.email)} · rol efectivo <b>${esc(s.role)}</b>. Permission Enforcement está activo y aplica el rol/permisos del token.</div>`
      : `<div class="notice"><b>Sin login Firebase.</b> El ERP continúa normalmente con <span class="mono">LOCAL_LEGACY</span>. Puede iniciar sesión para validar UID, token y claims reales.</div>`;
    if($('authLoginForm'))$('authLoginForm').style.display=signed?'none':'grid';
    if($('authLogout'))$('authLogout').style.display=signed?'inline-flex':'none';
    if($('authLoginUid'))$('authLoginUid').textContent=s?.uid||'—';
    if($('authLoginRole'))$('authLoginRole').textContent=s?.role||'LOCAL_LEGACY';
    if($('authLoginEmailCurrent'))$('authLoginEmailCurrent').textContent=s?.email||'—';
    if($('authLoginProviderCurrent'))$('authLoginProviderCurrent').textContent=signed?(a.provider||'FIREBASE_AUTH'):'LOCAL_LEGACY';
  }
}
export const loginUI=new LoginUI();
