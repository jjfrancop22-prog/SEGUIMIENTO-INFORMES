import {listPermissionDeclarations} from '../security/module-permission-registry.js';
import {securityManager} from '../security/security-manager.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function fmtRule(r){const parts=[];if(r.read)parts.push(`R: ${r.read}`);if(r.readAny?.length)parts.push(`R cualquiera: ${r.readAny.join(' | ')}`);if(r.write)parts.push(`W: ${r.write}`);if(r.writeAny?.length)parts.push(`W cualquiera: ${r.writeAny.join(' | ')}`);return parts.join(' · ')||'Solo navegación'}
export class DynamicPermissionUI{
  init(){this.refresh();return this}
  refresh(){
    const s=securityManager.sessions.current()||{};const effective=securityManager.permissions.effectivePermissions(s.role||'LOCAL_LEGACY');
    if($('dynamicPermissionRole'))$('dynamicPermissionRole').textContent=s.role||'—';
    if($('dynamicPermissionCount'))$('dynamicPermissionCount').textContent=String(effective.size);
    const rows=[];
    for(const m of listPermissionDeclarations()){
      const mAllowed=(m.read&&effective.has(m.read))||(m.readAny?.some(p=>effective.has(p)))||(!m.read&&!m.readAny?.length);
      rows.push(`<tr><td><b>${esc(m.label)}</b><br><span class="mono">${esc(m.id)}</span></td><td>${esc(fmtRule(m))}</td><td>${mAllowed?'<span class="badge green">VISIBLE</span>':'<span class="badge amber">OCULTO</span>'}</td><td>${m.views.length}</td></tr>`);
    }
    if($('dynamicPermissionRows'))$('dynamicPermissionRows').innerHTML=rows.join('');
  }
}
export const dynamicPermissionUI=new DynamicPermissionUI();
