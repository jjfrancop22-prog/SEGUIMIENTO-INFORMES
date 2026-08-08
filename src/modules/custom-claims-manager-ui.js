import {securityManager} from '../security/security-manager.js';
import {adminClaimsClient} from '../security/admin-claims-client.js';
import {CLOUD_ROLE_DEFINITIONS} from '../security/permission-engine.js';
import {eventBus} from '../core/event-bus.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>v?new Date(v).toLocaleString():'—';

function authErrorMessage(e){
  const raw=String(e?.message||e||'Error desconocido');
  if(raw.includes('unauthenticated'))return 'Debe iniciar sesión con Firebase Authentication.';
  if(raw.includes('permission-denied'))return 'El usuario actual no está autorizado para administrar roles. Configure el primer BOOTSTRAP_ADMIN_UID o use un ADMINISTRADOR.';
  if(raw.includes('not-found'))return 'No se encontró el usuario destino en Firebase Authentication.';
  if(raw.includes('unavailable')||raw.includes('Failed to fetch'))return 'No se pudo contactar el backend de Custom Claims. Verifique que Firebase Functions esté desplegado y la región sea correcta.';
  return raw;
}

export class CustomClaimsManagerUI{
  constructor(){this._bound=false;this.backendStatus=null;this.lastAssignment=null;this.users=[];this.userListError=null;this.selectedUid=null;}
  async init(){
    const role=$('claimsAdminRole');
    if(role&&!role.options.length){
      for(const def of Object.values(CLOUD_ROLE_DEFINITIONS).filter(x=>x.id!=='LOCAL_LEGACY')){
        const opt=document.createElement('option');opt.value=def.id;opt.textContent=`${def.label} · ${def.id}`;role.appendChild(opt);
      }
    }
    if($('claimsAdminRegion'))$('claimsAdminRegion').value=adminClaimsClient.status().region;
    if($('claimsAdminUseMe'))$('claimsAdminUseMe').onclick=()=>this.useCurrentUser();
    if($('claimsAdminCheck'))$('claimsAdminCheck').onclick=()=>this.checkBackend();
    if($('claimsAdminLoadUsers'))$('claimsAdminLoadUsers').onclick=()=>this.loadUsers();
    if($('claimsAdminAssign'))$('claimsAdminAssign').onclick=()=>this.assign();
    if($('claimsAdminRegionSave'))$('claimsAdminRegionSave').onclick=async()=>{
      adminClaimsClient.setRegion($('claimsAdminRegion')?.value||'us-central1');
      this.backendStatus=null;this.users=[];this.userListError=null;
      await adminClaimsClient.init();await this.refresh();
    };
    if(role)role.onchange=()=>this.refresh();
    if(!$('claimsAdminSearch')?.dataset.bound){
      const search=$('claimsAdminSearch');
      if(search){search.dataset.bound='1';search.addEventListener('input',()=>this.renderUsers());}
    }
    if(!this._bound){
      this._bound=true;
      eventBus.on('security:session-changed',()=>this.refresh());
      eventBus.on('security:auth-runtime',()=>this.refresh());
    }
    await adminClaimsClient.init();
    await this.refresh();
  }
  useCurrentUser(){
    const s=securityManager.sessions.current()||{};
    if($('claimsAdminUid'))$('claimsAdminUid').value=s.uid||'';
    if($('claimsAdminEmail'))$('claimsAdminEmail').value=s.email||'';
    this.selectedUid=s.uid||null;
    this.renderUsers();
  }
  selectUser(uid){
    const user=this.users.find(x=>x.uid===uid);if(!user)return;
    this.selectedUid=user.uid;
    if($('claimsAdminUid'))$('claimsAdminUid').value=user.uid||'';
    if($('claimsAdminEmail'))$('claimsAdminEmail').value=user.email||'';
    if(user.role&&$('claimsAdminRole'))$('claimsAdminRole').value=user.role;
    this.renderUsers();this.refresh();
  }
  async checkBackend(){
    const box=$('claimsAdminMessage');
    try{
      if(box)box.innerHTML='<div class="notice">Comprobando backend administrativo…</div>';
      this.backendStatus=await adminClaimsClient.adminStatus();
      if(this.backendStatus?.authorized)await this.loadUsers({silent:true});
    }catch(e){this.backendStatus={authorized:false,error:authErrorMessage(e)};}
    await this.refresh();
  }
  async loadUsers({silent=false}={}){
    const box=$('claimsAdminMessage');
    try{
      this.userListError=null;
      if(!silent&&box)box.innerHTML='<div class="notice">Consultando usuarios de Firebase Authentication…</div>';
      const result=await adminClaimsClient.listUsers({maxResults:500});
      this.users=Array.isArray(result?.users)?result.users:[];
    }catch(e){this.users=[];this.userListError=authErrorMessage(e);}
    this.renderUsers();
    if(!silent)await this.refresh();
  }
  async assign(){
    const box=$('claimsAdminMessage'),btn=$('claimsAdminAssign');
    try{
      if(btn)btn.disabled=true;
      if(box)box.innerHTML='<div class="notice">Asignando Custom Claims mediante backend administrativo…</div>';
      const result=await adminClaimsClient.assignRole({uid:$('claimsAdminUid')?.value,email:$('claimsAdminEmail')?.value,role:$('claimsAdminRole')?.value});
      this.lastAssignment=result;
      const current=securityManager.sessions.current()||{};
      if(result?.uid&&result.uid===current.uid){
        await securityManager.authRuntime.refreshToken().catch(()=>null);
      }
      if(this.backendStatus?.authorized)await this.loadUsers({silent:true});
      await this.refresh();
    }catch(e){this.lastAssignment={ok:false,error:authErrorMessage(e)};await this.refresh();}
    finally{if(btn)btn.disabled=false;}
  }
  renderUsers(){
    const body=$('claimsAdminUsersRows');if(!body)return;
    const q=String($('claimsAdminSearch')?.value||'').trim().toLowerCase();
    const list=this.users.filter(u=>!q||[u.email,u.displayName,u.uid,u.role].some(v=>String(v||'').toLowerCase().includes(q)));
    if(this.userListError){body.innerHTML=`<tr><td colspan="7"><div class="warning">${esc(this.userListError)}</div></td></tr>`;return;}
    if(!list.length){body.innerHTML=`<tr><td colspan="7" class="empty">${this.users.length?'No hay coincidencias.':'Pulse “Cargar usuarios Firebase”.'}</td></tr>`;return;}
    body.innerHTML=list.map(u=>`<tr${u.uid===this.selectedUid?' style="background:#eef8f1"':''}>
      <td><b>${esc(u.email||'Sin email')}</b><br><span class="muted">${esc(u.displayName||'')}</span></td>
      <td class="mono">${esc(u.uid)}</td>
      <td><span class="badge ${u.role==='ADMINISTRADOR'?'green':u.role?'blue':'amber'}">${esc(u.role||'SIN CLAIM')}</span></td>
      <td>${u.emailVerified?'Sí':'No'}</td><td>${u.disabled?'SUSPENDIDO':'ACTIVO'}</td>
      <td>${esc(fmt(u.lastSignInAt))}</td>
      <td><button class="btn small secondary claims-user-select" data-uid="${esc(u.uid)}" type="button">Seleccionar</button></td>
    </tr>`).join('');
    body.querySelectorAll('.claims-user-select').forEach(btn=>btn.onclick=()=>this.selectUser(btn.dataset.uid));
    if($('claimsAdminUsersCount'))$('claimsAdminUsersCount').textContent=String(this.users.length);
  }
  async refresh(){
    const s=securityManager.sessions.current()||{},cs=adminClaimsClient.status(),authorized=this.backendStatus?.authorized===true;
    if($('claimsAdminBackend'))$('claimsAdminBackend').textContent=this.backendStatus?.error?'ERROR':(this.backendStatus?'RESPONDE':'SIN PROBAR');
    if($('claimsAdminCaller'))$('claimsAdminCaller').textContent=s.authenticated?`${s.email||s.uid||'Usuario'} · ${s.role||'LOCAL_LEGACY'}`:'SIGNED_OUT';
    if($('claimsAdminAuthorized'))$('claimsAdminAuthorized').textContent=this.backendStatus?(authorized?'SÍ':'NO'):'—';
    if($('claimsAdminRegionCard'))$('claimsAdminRegionCard').textContent=cs.region||'us-central1';
    if($('claimsAdminAssign'))$('claimsAdminAssign').disabled=!s.authenticated;
    if($('claimsAdminLoadUsers'))$('claimsAdminLoadUsers').disabled=!s.authenticated;
    if($('claimsAdminPermissionsPreview')){
      const role=$('claimsAdminRole')?.value||'ADMINISTRADOR',def=CLOUD_ROLE_DEFINITIONS[role];
      $('claimsAdminPermissionsPreview').innerHTML=(def?.permissions||[]).map(p=>`<span class="badge" style="margin:2px">${esc(p)}</span>`).join('')||'<span class="muted">Seleccione un rol.</span>';
    }
    const msg=$('claimsAdminMessage');
    if(msg){
      if(this.lastAssignment?.ok){
        const same=this.lastAssignment.uid===s.uid;
        msg.innerHTML=`<div class="notice"><b>ROL ASIGNADO:</b> ${esc(this.lastAssignment.email||this.lastAssignment.uid)} → <b>${esc(this.lastAssignment.role)}</b>. ${same?'Token actualizado: el rol efectivo debe cambiar inmediatamente.':'El usuario destino recibirá el nuevo claim al refrescar token o volver a iniciar sesión.'}</div>`;
      }else if(this.lastAssignment?.error)msg.innerHTML=`<div class="warning"><b>No se pudo asignar:</b> ${esc(this.lastAssignment.error)}</div>`;
      else if(this.backendStatus?.error)msg.innerHTML=`<div class="warning"><b>Backend no disponible:</b> ${esc(this.backendStatus.error)}</div>`;
      else if(this.backendStatus)msg.innerHTML=authorized?'<div class="notice"><b>BACKEND ADMINISTRATIVO LISTO.</b> Puede cargar usuarios y asignar roles.</div>':'<div class="warning"><b>Backend responde, pero el usuario actual NO está autorizado.</b></div>';
      else msg.innerHTML='<div class="notice"><b>Modo seguro:</b> pulse “Comprobar backend”. Después podrá cargar los usuarios de Firebase Authentication.</div>';
    }
    if($('claimsAdminDetails'))$('claimsAdminDetails').innerHTML=`<div class="table-wrap"><table><tbody>
      <tr><th>Usuario actual</th><td>${esc(s.email||s.uid)}</td></tr><tr><th>UID actual</th><td class="mono">${esc(s.uid)}</td></tr>
      <tr><th>Rol efectivo actual</th><td><b>${esc(s.role)}</b></td></tr><tr><th>Backend Functions</th><td>${esc(this.backendStatus?.error?'ERROR':(this.backendStatus?'RESPONDE':'SIN PROBAR'))}</td></tr>
      <tr><th>Autorizado como administrador</th><td>${this.backendStatus?esc(authorized?'SÍ':'NO'):'—'}</td></tr><tr><th>Usuarios cargados</th><td>${esc(this.users.length)}</td></tr>
      <tr><th>Región</th><td>${esc(cs.region)}</td></tr><tr><th>Último éxito cliente</th><td>${esc(fmt(cs.lastSuccessAt))}</td></tr><tr><th>AUTH_ENFORCEMENT</th><td><b>ACTIVO</b></td></tr>
    </tbody></table></div>`;
    this.renderUsers();
  }
}
export const customClaimsManagerUI=new CustomClaimsManagerUI();
