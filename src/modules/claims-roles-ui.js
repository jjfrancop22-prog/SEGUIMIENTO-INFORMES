import {securityManager} from '../security/security-manager.js';
import {eventBus} from '../core/event-bus.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function badge(text,kind='green'){return `<span class="badge ${kind}">${esc(text)}</span>`}
export class ClaimsRolesUI{
  constructor(){this._bound=false;}
  async init(){
    if($('claimsRolesRefresh'))$('claimsRolesRefresh').onclick=async()=>{await securityManager.authRuntime.refreshToken().catch(()=>null);await this.refresh();};
    if(!this._bound){
      this._bound=true;
      eventBus.on('security:session-changed',()=>this.refresh());
      eventBus.on('security:auth-runtime',()=>this.refresh());
    }
    await this.refresh();
  }
  async refresh(){
    const s=securityManager.sessions.current()||{};
    const st=securityManager.status();
    const perms=[...securityManager.permissions.effectivePermissions(s.role||'LOCAL_LEGACY')].sort();
    const claims=s.claims||{};
    if($('claimsRoleEffective'))$('claimsRoleEffective').textContent=s.role||'LOCAL_LEGACY';
    if($('claimsRoleSource'))$('claimsRoleSource').textContent=s.roleSource||'FALLBACK_LOCAL_LEGACY';
    if($('claimsRoleCount'))$('claimsRoleCount').textContent=String(perms.length);
    if($('claimsRoleStatus'))$('claimsRoleStatus').innerHTML=s.authenticated
      ? (s.roleSource==='CUSTOM_CLAIM'||s.roleSource==='BOOLEAN_ADMIN_CLAIM'
        ? `<div class="notice"><b>CLAIM RECONOCIDO:</b> Firebase asignó el rol <b>${esc(s.role)}</b>. AUTH_ENFORCEMENT está ACTIVO; los módulos y acciones respetan estos permisos.</div>`
        : `<div class="warning"><b>Sin claim de rol:</b> sesión Firebase válida, pero no existe un rol reconocido en el token. Se mantiene <b>LOCAL_LEGACY</b> como fallback seguro.</div>`)
      : `<div class="notice"><b>Sin sesión Firebase:</b> el ERP continúa con LOCAL_LEGACY.</div>`;
    if($('claimsRoleDetails'))$('claimsRoleDetails').innerHTML=`<div class="table-wrap"><table><tbody>
      <tr><th>Autenticado</th><td>${badge(s.authenticated?'SÍ':'NO',s.authenticated?'green':'amber')}</td></tr>
      <tr><th>UID</th><td class="mono">${esc(s.uid)}</td></tr>
      <tr><th>Rol efectivo</th><td><b>${esc(s.role)}</b></td></tr>
      <tr><th>Fuente del rol</th><td>${esc(s.roleSource)}</td></tr>
      <tr><th>Claim original</th><td class="mono">${esc(s.roleClaimRaw)}</td></tr>
      <tr><th>Permisos efectivos</th><td>${perms.length}</td></tr>
      <tr><th>Enforcement</th><td>${badge(st.enforcement?'ACTIVO':'DESACTIVADO',st.enforcement?'red':'green')}</td></tr>
    </tbody></table></div>`;
    if($('claimsRolePermissions'))$('claimsRolePermissions').innerHTML=perms.length?perms.map(p=>`<span class="badge" style="margin:2px">${esc(p)}</span>`).join(''):'<span class="muted">Sin permisos calculados.</span>';
    if($('claimsRoleRaw'))$('claimsRoleRaw').textContent=JSON.stringify(claims,null,2);
  }
}
export const claimsRolesUI=new ClaimsRolesUI();
