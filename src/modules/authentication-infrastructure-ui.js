import {securityManager} from '../security/security-manager.js';
const $=id=>document.getElementById(id);const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function badge(ok,yes='LISTO',no='PENDIENTE'){return `<span class="badge ${ok?'green':'amber'}">${ok?yes:no}</span>`}
export class AuthenticationInfrastructureUI{
  async init(){if($('authInfraRefresh'))$('authInfraRefresh').onclick=()=>this.refresh();if($('authInfraToken'))$('authInfraToken').onclick=()=>this.inspectToken();await this.refresh()}
  async refresh(){
    const st=securityManager.status(),a=securityManager.authentication.status(),s=securityManager.sessions.current();
    if($('authInfraState'))$('authInfraState').textContent=a.state||'—';
    if($('authInfraProvider'))$('authInfraProvider').textContent=a.provider||'—';
    if($('authInfraReady'))$('authInfraReady').textContent=a.ready?'SÍ':'NO';
    if($('authInfraEnforced'))$('authInfraEnforced').textContent=st.enforcement?'SÍ':'NO';
    if($('authInfraSession'))$('authInfraSession').innerHTML=`<div class="table-wrap"><table><tbody><tr><th>Estado Auth</th><td>${esc(a.state)}</td></tr><tr><th>Proveedor</th><td>${esc(a.provider)}</td></tr><tr><th>SDK preparado</th><td>${badge(!!a.ready,'SÍ','NO')}</td></tr><tr><th>Autenticado</th><td>${badge(!!s?.authenticated,'SÍ','NO')}</td></tr><tr><th>UID</th><td class="mono">${esc(s?.uid)}</td></tr><tr><th>Rol efectivo</th><td>${esc(s?.role)}</td></tr><tr><th>Device ID</th><td class="mono">${esc(s?.deviceId)}</td></tr><tr><th>Email</th><td>${esc(s?.email)}</td></tr><tr><th>Token expira</th><td>${esc(s?.tokenExpiresAt)}</td></tr><tr><th>Último login</th><td>${esc(s?.lastLoginAt)}</td></tr><tr><th>Último error</th><td>${esc(a.lastError)}</td></tr></tbody></table></div>`;
    if($('authInfraInfo'))$('authInfraInfo').innerHTML=`<div class="notice ${a.ready?'':'warn'}"><b>${a.ready?'AUTH READY':'AUTH PENDIENTE'}:</b> Firebase Authentication real está ${a.ready?'inicializado, restaurando sesión y observando identidad/token':'sin inicializar'}. <b>No es obligatorio</b>; el ERP sigue operando con LOCAL_LEGACY mientras no exista una sesión autenticada.</div>`;
  }
  async inspectToken(){const token=await securityManager.authentication.tokenInfo();if($('authTokenInfo'))$('authTokenInfo').textContent=JSON.stringify(token||{authenticated:false,message:'No existe token porque todavía no hay usuario autenticado.'},null,2);await this.refresh()}
}
export const authenticationInfrastructureUI=new AuthenticationInfrastructureUI();
