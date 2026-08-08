import {securityManager} from '../security/security-manager.js';
import {adminClaimsClient} from '../security/admin-claims-client.js';
import {CLOUD_ROLE_DEFINITIONS} from '../security/permission-engine.js';
import {auditRepository} from '../data/audit-repository.js';
import {eventBus} from '../core/event-bus.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>v?new Date(v).toLocaleString():'—';
function msg(e){const raw=String(e?.message||e||'Error desconocido');if(raw.includes('unauthenticated'))return 'Debe iniciar sesión.';if(raw.includes('permission-denied'))return 'Se requiere rol ADMINISTRADOR.';if(raw.includes('already-exists'))return 'Ya existe un usuario con ese email.';if(raw.includes('not-found'))return 'Usuario no encontrado.';if(raw.includes('failed-precondition'))return raw.split(':').pop().trim();return raw;}

export class EnterpriseUserManagerUI{
  constructor(){this.users=[];this.selected=null;this.notice='';this._bound=false;this.newMode=true;}
  async init(){
    const role=$('eumRole');
    if(role&&!role.options.length)for(const d of Object.values(CLOUD_ROLE_DEFINITIONS).filter(x=>x.id!=='LOCAL_LEGACY')){const o=document.createElement('option');o.value=d.id;o.textContent=`${d.label} · ${d.id}`;role.appendChild(o)}
    if(!$('eumSearch')?.dataset.bound){$('eumSearch').dataset.bound='1';$('eumSearch').addEventListener('input',()=>this.render())}
    for(const id of ['eumName','eumEmail','eumPassword','eumRole']){const el=$(id);if(el&&!el.dataset.modeBound){el.dataset.modeBound='1';el.addEventListener('input',()=>this.syncActionMode());el.addEventListener('change',()=>this.syncActionMode())}}
    $('eumRefresh')?.addEventListener('click',()=>this.load());
    $('eumNew')?.addEventListener('click',()=>this.clearForm(true));
    $('eumCreate')?.addEventListener('click',()=>this.create());
    $('eumSaveProfile')?.addEventListener('click',()=>this.saveProfile());
    $('eumSaveRole')?.addEventListener('click',()=>this.saveRole());
    $('eumToggleDisabled')?.addEventListener('click',()=>this.toggleDisabled());
    $('eumChangePassword')?.addEventListener('click',()=>this.changePassword());
    $('eumResetPassword')?.addEventListener('click',()=>this.resetPassword());
    $('eumCopyReset')?.addEventListener('click',()=>navigator.clipboard?.writeText($('eumResetLink')?.value||''));
    if(!this._bound){this._bound=true;eventBus.on('security:session-changed',()=>this.refreshHeader())}
    await this.load();
    this.clearForm(true);
  }
  async _audit(action,user,metadata={}){const s=securityManager.sessions.current()||{};await auditRepository.record({action,domain:'SECURITY',entityId:user?.uid||'',entityType:'FirebaseAuthUser',userId:s.uid||s.email||'ADMIN',after:{email:user?.email||null,displayName:user?.displayName||null,role:user?.role||null,disabled:user?.disabled??null},metadata}).catch(()=>{});}
  async load(){
    try{this.notice='Cargando usuarios Firebase…';this.renderNotice();const r=await adminClaimsClient.listUsers({maxResults:1000});this.users=Array.isArray(r?.users)?r.users:[];this.notice=`${this.users.length} usuario(s) cargados.`;if(this.selected){const f=this.users.find(x=>x.uid===this.selected.uid);if(f)this.select(f.uid)}}catch(e){this.notice=`Error: ${msg(e)}`}
    this.render();this.renderNotice();this.refreshHeader();
  }
  clearForm(newMode=false){this.selected=null;this.newMode=!!newMode;['eumUid','eumEmail','eumName','eumPassword','eumResetLink'].forEach(id=>{if($(id))$(id).value=''});if($('eumRole'))$('eumRole').value='CONSULTA';this.syncActionMode();this.notice=this.newMode?'Nuevo usuario: ingrese nombre, email, contraseña inicial y rol.':'Seleccione un usuario.';this.renderNotice();this.render()}
  syncActionMode(){const hasUid=!!String($('eumUid')?.value||'').trim();const isNew=!this.selected&&!hasUid;this.newMode=isNew;if($('eumCreate')){$('eumCreate').hidden=!isNew;$('eumCreate').textContent='Crear usuario'}if($('eumExistingActions'))$('eumExistingActions').hidden=isNew;return isNew}
  select(uid){const u=this.users.find(x=>x.uid===uid);if(!u)return;this.selected=u;this.newMode=false;$('eumUid').value=u.uid||'';$('eumEmail').value=u.email||'';$('eumName').value=u.displayName||'';$('eumRole').value=u.role||'CONSULTA';$('eumPassword').value='';$('eumResetLink').value='';this.syncActionMode();$('eumToggleDisabled').textContent=u.disabled?'Activar usuario':'Suspender usuario';this.notice=`Usuario seleccionado: ${u.email||u.uid}`;this.renderNotice();this.render()}
  async create(){try{if(!this.syncActionMode()){this.notice='La ficha corresponde a un usuario existente. Use Nuevo usuario para crear otra cuenta.';return this.renderNotice()}const email=$('eumEmail').value.trim(),password=$('eumPassword').value,displayName=$('eumName').value.trim(),role=$('eumRole').value;if(!displayName){this.notice='Ingrese el nombre del usuario.';return this.renderNotice()}if(!email||!/^\S+@\S+\.\S+$/.test(email)){this.notice='Ingrese un email válido.';return this.renderNotice()}if(!password||password.length<6){this.notice='La contraseña inicial debe tener mínimo 6 caracteres.';return this.renderNotice()}if(!role||!CLOUD_ROLE_DEFINITIONS[role]||role==='LOCAL_LEGACY'){this.notice='Seleccione un rol válido.';return this.renderNotice()}const r=await adminClaimsClient.createUser({email,password,displayName,role});await this._audit('SECURITY_USER_CREATED',r.user,{backendAudit:r.audit});const createdEmail=r.user?.email||email;await this.load();this.clearForm(true);this.notice=`Usuario creado y ACTIVO: ${createdEmail} · ${role}. UID generado por Firebase correctamente.`;this.renderNotice();this.render()}catch(e){this.notice=`No se pudo crear: ${msg(e)}`;this.renderNotice()}}
  async saveProfile(){if(!this.selected)return;try{const r=await adminClaimsClient.updateUser({uid:this.selected.uid,email:$('eumEmail').value.trim(),displayName:$('eumName').value.trim()});await this._audit('SECURITY_USER_PROFILE_UPDATED',r.user,{backendAudit:r.audit});this.notice='Perfil actualizado.';await this.load();this.select(r.user.uid)}catch(e){this.notice=`No se pudo actualizar: ${msg(e)}`;this.renderNotice()}}
  async saveRole(){if(!this.selected)return;try{const r=await adminClaimsClient.assignRole({uid:this.selected.uid,role:$('eumRole').value});await this._audit('SECURITY_USER_ROLE_UPDATED',{...this.selected,role:r.role},{backendAudit:r.audit});const cur=securityManager.sessions.current()||{};if(r.uid===cur.uid)await securityManager.authRuntime.refreshToken().catch(()=>null);this.notice=`Rol actualizado a ${r.role}.`;await this.load();this.select(r.uid)}catch(e){this.notice=`No se pudo cambiar rol: ${msg(e)}`;this.renderNotice()}}
  async toggleDisabled(){if(!this.selected)return;try{const target=!this.selected.disabled;const r=await adminClaimsClient.setDisabled({uid:this.selected.uid,disabled:target});await this._audit(target?'SECURITY_USER_DISABLED':'SECURITY_USER_ENABLED',{...this.selected,disabled:target},{backendAudit:r.audit});this.notice=target?'Usuario suspendido.':'Usuario activado.';await this.load();this.select(r.uid)}catch(e){this.notice=`No se pudo cambiar estado: ${msg(e)}`;this.renderNotice()}}
  async changePassword(){if(!this.selected)return;const password=$('eumPassword').value;if(!password){this.notice='Ingrese una nueva contraseña.';return this.renderNotice()}try{const r=await adminClaimsClient.setPassword({uid:this.selected.uid,password,revokeSessions:true});await this._audit('SECURITY_USER_PASSWORD_CHANGED',this.selected,{backendAudit:r.audit});$('eumPassword').value='';this.notice='Contraseña actualizada y sesiones anteriores revocadas.';this.renderNotice()}catch(e){this.notice=`No se pudo cambiar contraseña: ${msg(e)}`;this.renderNotice()}}
  async resetPassword(){if(!this.selected)return;try{const r=await adminClaimsClient.generateResetLink({uid:this.selected.uid});$('eumResetLink').value=r.resetLink||'';await this._audit('SECURITY_PASSWORD_RESET_LINK_GENERATED',this.selected,{backendAudit:r.audit});this.notice='Enlace de restablecimiento generado. Puede copiarlo y entregarlo al usuario.';this.renderNotice()}catch(e){this.notice=`No se pudo generar enlace: ${msg(e)}`;this.renderNotice()}}
  renderNotice(){if($('eumMessage'))$('eumMessage').innerHTML=`<div class="notice">${esc(this.notice||'Enterprise User Manager listo.')}</div>`}
  refreshHeader(){const s=securityManager.sessions.current()||{};if($('eumCurrentAdmin'))$('eumCurrentAdmin').textContent=s.email||s.uid||'—';if($('eumCurrentRole'))$('eumCurrentRole').textContent=s.role||'—';if($('eumCount'))$('eumCount').textContent=String(this.users.length)}
  render(){const body=$('eumRows');if(!body)return;const q=String($('eumSearch')?.value||'').trim().toLowerCase();const rows=this.users.filter(u=>!q||[u.email,u.displayName,u.uid,u.role,u.disabled?'suspendido':'activo'].some(v=>String(v||'').toLowerCase().includes(q)));body.innerHTML=rows.length?rows.map(u=>`<tr${this.selected?.uid===u.uid?' style="background:#eef8f1"':''}><td><b>${esc(u.displayName||'Sin nombre')}</b><br><span class="muted">${esc(u.email||'Sin email')}</span></td><td class="mono">${esc(u.uid)}</td><td><span class="badge ${u.role==='ADMINISTRADOR'?'green':'blue'}">${esc(u.role||'SIN CLAIM')}</span></td><td>${u.emailVerified?'Sí':'No'}</td><td><span class="badge ${u.disabled?'amber':'green'}">${u.disabled?'SUSPENDIDO':'ACTIVO'}</span></td><td>${esc(fmt(u.lastSignInAt))}</td><td><button class="btn small secondary eum-select" data-uid="${esc(u.uid)}" type="button">Administrar</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">No hay usuarios que mostrar.</td></tr>';body.querySelectorAll('.eum-select').forEach(b=>b.onclick=()=>this.select(b.dataset.uid));this.refreshHeader();this.syncActionMode()}
}
export const enterpriseUserManagerUI=new EnterpriseUserManagerUI();
