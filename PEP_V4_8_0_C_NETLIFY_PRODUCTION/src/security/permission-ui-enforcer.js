import {securityManager} from './security-manager.js';
import {SECURITY_PERMISSIONS} from './permission-engine.js';
import {eventBus} from '../core/event-bus.js';
import {moduleDeclaration,viewDeclaration} from './module-permission-registry.js';

const P=SECURITY_PERMISSIONS;
const WRITE_WORDS=/\b(guardar|eliminar|editar|registrar|resolver|enviar|autorizar|aprobar|rechazar|ingresar|cargar muestra|importar|asignar rol|crear|agregar|actualizar registro|consumir|dar de baja|migrar|recuperar|cambiar contraseña|suspender|activar usuario)\b/i;
const SAFE_WORDS=/\b(buscar|filtrar|limpiar filtros|ver|historial|excel|exportar|descargar|actualizar claims|actualizar auth|inspeccionar token|comprobar backend|cargar usuarios firebase|usar mi usuario|actualizar salud|sincronizar ahora|cerrar sesión)\b/i;

function ownerFor(el){
  const view=el?.closest?.('.view');
  if(view){const tab=document.querySelector(`.tab[data-view="${view.id}"]`);return tab?.dataset?.moduleOwner||null;}
  return el?.closest?.('[data-module-owner]')?.dataset?.moduleOwner||null;
}
function viewFor(el){return el?.closest?.('.view')?.id||null;}
function session(){return securityManager.sessions.current()||{};}
function claimed(){const s=session();return !!s.authenticated&&!!s.role&&s.role!=='LOCAL_LEGACY';}
function can(permission){return claimed()&&securityManager.authorize(permission).allowed;}
function any(perms=[]){return perms.some(can);}
function allowsRule(rule){
  if(!rule)return false;
  if(rule.read)return can(rule.read);
  if(rule.readAny?.length)return any(rule.readAny);
  return true;
}

export class PermissionUIEnforcer{
  constructor({toast}={}){this.toast=toast||(()=>{});this._bound=false;}
  canOpenModule(moduleId){
    if(!claimed())return false;
    const rule=moduleDeclaration(moduleId);
    return rule?allowsRule(rule):true;
  }
  canOpenView(viewId,moduleId){
    if(!claimed())return false;
    const rule=viewDeclaration(viewId,moduleId);
    return rule?allowsRule(rule):this.canOpenModule(moduleId);
  }
  writePermissionFor(el){
    if(el?.closest?.('#customClaimsManagerCard,#enterpriseUserManagerCard'))return P.SECURITY_ADMIN;
    if(el?.closest?.('#clientsModal'))return P.CLIENTS_WRITE;
    if(el?.closest?.('#matricesModal'))return P.CATALOGS_WRITE;
    if(el?.closest?.('[data-client-catalog]'))return P.CLIENTS_WRITE;
    if(el?.closest?.('[data-matrix-catalog]'))return P.CATALOGS_WRITE;
    const viewId=viewFor(el);const owner=ownerFor(el);const rule=viewDeclaration(viewId,owner);
    if(rule?.write)return rule.write;
    if(rule?.writeAny?.length)return rule.writeAny.find(p=>can(p))||rule.writeAny[0]||null;
    const moduleRule=moduleDeclaration(owner);return moduleRule?.write||null;
  }
  isMutation(el){
    if(!el)return false;
    if(el.matches?.('form#sampleForm'))return true;
    if(el.closest?.('[data-safe-delete-sample],[data-edit],[data-analysis],[data-waiting],[data-lab-save-analyst],[data-lab-open]'))return true;
    const btn=el.closest?.('button,input[type="submit"]');if(!btn)return false;
    const text=`${btn.id||''} ${btn.textContent||btn.value||''}`.trim();
    if(SAFE_WORDS.test(text))return false;
    return WRITE_WORDS.test(text)||btn.type==='submit';
  }
  guardMutation(el){
    if(!this.isMutation(el))return true;
    const p=this.writePermissionFor(el);if(!p)return true;
    if(can(p))return true;
    this.toast(`Acción bloqueada por rol · requiere ${p}`,true);return false;
  }
  applyReadOnlyState(){
    document.querySelectorAll('.view').forEach(view=>{
      const tab=document.querySelector(`.tab[data-view="${view.id}"]`);const owner=tab?.dataset?.moduleOwner||null;
      const rule=viewDeclaration(view.id,owner);const moduleRule=moduleDeclaration(owner);
      const writePermission=rule?.write||moduleRule?.write||null;const writeAny=rule?.writeAny||[];
      if(!writePermission&&!writeAny.length)return;
      const writable=writePermission?can(writePermission):writeAny.some(can);view.dataset.permissionMode=writable?'write':'read';
      view.querySelectorAll('[contenteditable="true"]').forEach(el=>{el.contentEditable=writable?'true':'false';});
      view.querySelectorAll('button,input[type="submit"]').forEach(btn=>{
        if(!this.isMutation(btn))return;
        const p=this.writePermissionFor(btn)||writePermission;const allowed=can(p);btn.disabled=!allowed;btn.setAttribute('aria-disabled',String(!allowed));btn.title=allowed?'':`Solo lectura · requiere ${p}`;
      });
    });
  }
  apply(){
    document.body.dataset.authEnforcement='role-engine';
    const s=session();const role=claimed()?s.role:'SIN_ROL';
    document.querySelectorAll('.module-tab[data-module]').forEach(btn=>{btn.hidden=!this.canOpenModule(btn.dataset.module);});
    document.querySelectorAll('.tab[data-view]').forEach(btn=>{btn.hidden=!this.canOpenView(btn.dataset.view,btn.dataset.moduleOwner);});
    for(const id of ['customClaimsManagerCard','enterpriseUserManagerCard']){const card=document.getElementById(id);if(card)card.hidden=!claimed()||!can(P.SECURITY_ADMIN);}
    this.applyReadOnlyState();
    const badge=document.getElementById('permissionEnforcementBadge');if(badge)badge.textContent=claimed()?`ROLE ENGINE · ${role}`:'LOGIN REQUERIDO';
    const detail=document.getElementById('permissionEnforcementDetail');if(detail)detail.innerHTML=claimed()?`<div class="notice"><b>ROLE ENFORCEMENT ENGINE ACTIVO.</b> Rol <b>${role}</b> · ${securityManager.status().effectivePermissionCount} permisos efectivos. Navegación, vistas y mutaciones están gobernadas por la matriz de permisos.</div>`:`<div class="notice warn"><b>LOGIN REQUERIDO.</b> No se habilita ninguna vista operativa hasta autenticar un usuario con Custom Claim reconocido.</div>`;
  }
  firstAllowed(){
    for(const m of ['dashboard','monitoring','laboratory','reports','billing','receivables','tracking','system'])if(this.canOpenModule(m)){
      const tab=[...document.querySelectorAll(`.subnav[data-subnav="${m}"] .tab[data-view]`)].find(x=>!x.hidden&&this.canOpenView(x.dataset.view,m));
      if(tab)return tab.dataset.view;
    }
    return null;
  }
  ensureCurrentAllowed(){
    const active=document.querySelector('.view.active');if(!active)return;
    const tab=document.querySelector(`.tab[data-view="${active.id}"]`);const owner=tab?.dataset.moduleOwner||null;
    if(!this.canOpenView(active.id,owner)){
      const next=this.firstAllowed();if(next)document.querySelector(`.tab[data-view="${next}"]`)?.click();
    }
  }
  init(){
    if(this._bound)return this.apply();this._bound=true;
    document.addEventListener('click',e=>{const target=e.target.closest('button,input[type="submit"]');if(target&&!this.guardMutation(target)){e.preventDefault();e.stopImmediatePropagation();}},true);
    document.addEventListener('submit',e=>{if(!this.guardMutation(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
    eventBus.on('security:session-changed',()=>{this.apply();setTimeout(()=>this.ensureCurrentAllowed(),0)});
    eventBus.on('security:auth-runtime',()=>{this.apply();setTimeout(()=>this.ensureCurrentAllowed(),0)});
    eventBus.on('security:claims-refreshed',()=>{this.apply();setTimeout(()=>this.ensureCurrentAllowed(),0)});
    this.apply();
  }
}
