import {securityManager} from '../security/security-manager.js';
const $=id=>document.getElementById(id);const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function badge(ok,yes='LISTO',no='PENDIENTE'){return `<span class="badge ${ok?'green':'amber'}">${ok?yes:no}</span>`}
export class SecurityFoundationUI{
  async init(){if($('securityRefresh'))$('securityRefresh').onclick=()=>this.refresh();await this.refresh()}
  async refresh(){
    const st=securityManager.status(),s=securityManager.sessions.current(),roles=securityManager.permissions.listRoles();
    if($('secMode'))$('secMode').textContent=st.mode;
    if($('secEnforcement'))$('secEnforcement').textContent=st.enforcement?'ACTIVO':'DESACTIVADO';
    if($('secProvider'))$('secProvider').textContent=st.authenticationProvider;
    if($('secRole'))$('secRole').textContent=s?.role||'LOCAL_LEGACY';
    if($('secSession'))$('secSession').innerHTML=`<div class="notice"><b>Foundation preparada:</b> autenticación todavía NO es obligatoria. La sesión actual continúa en modo local para no alterar el ERP ni el Live Sync.</div><div class="table-wrap"><table><tbody><tr><th>Modo sesión</th><td>${esc(s?.mode)}</td></tr><tr><th>Autenticado</th><td>${badge(!!s?.authenticated,'SÍ','NO')}</td></tr><tr><th>UID</th><td class="mono">${esc(s?.uid)}</td></tr><tr><th>Rol efectivo</th><td>${esc(s?.role)}</td></tr><tr><th>Device ID</th><td class="mono">${esc(s?.deviceId)}</td></tr><tr><th>Proveedor</th><td>${esc(s?.provider)}</td></tr></tbody></table></div>`;
    if($('secRoles'))$('secRoles').innerHTML=roles.map(r=>`<tr><td><b>${esc(r.label||r.id)}</b><div class="muted mono">${esc(r.id)}</div></td><td>${r.permissions?.length||0}</td><td style="max-width:720px">${(r.permissions||[]).map(p=>`<span class="badge" style="margin:2px">${esc(p)}</span>`).join('')}</td></tr>`).join('');
    if($('secContract'))$('secContract').textContent=JSON.stringify(securityManager.futureIdentityContract(),null,2);
  }
}
export const securityFoundationUI=new SecurityFoundationUI();
