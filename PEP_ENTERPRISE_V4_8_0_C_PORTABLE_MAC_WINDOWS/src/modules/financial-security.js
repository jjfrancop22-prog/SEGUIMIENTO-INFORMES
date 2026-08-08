import {get,put} from '../data/database.js';
import {STORES} from '../data/schema.js';

const SECURITY_ID='financial_module_access';
const FINANCIAL_MODULES=new Set(['billing','receivables']);
let unlocked=false;
let pendingResolve=null;
let configured=false;

function bytesToHex(buf){return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function randomSalt(){const b=new Uint8Array(16);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hashPassword(password,salt){const data=new TextEncoder().encode(`${salt}:${password}`);return bytesToHex(await crypto.subtle.digest('SHA-256',data))}
async function record(){return await get(STORES.meta,SECURITY_ID)}
async function saveRecord(value){await put(STORES.meta,{id:SECURITY_ID,...value,updatedAt:new Date().toISOString()})}
function el(id){return document.getElementById(id)}
function clearErrors(){const e=el('finSecError');if(e)e.textContent=''}
function error(msg){const e=el('finSecError');if(e)e.textContent=msg}
function resetInputs(){['finSecPassword','finSecConfirm','finSecCurrent'].forEach(id=>{if(el(id))el(id).value=''})}
function show(mode='unlock'){
  clearErrors();resetInputs();
  const modal=el('financialSecurityModal');if(!modal)return;
  const setup=mode==='setup',change=mode==='change';
  el('finSecTitle').textContent=setup?'Crear contraseña financiera':change?'Cambiar contraseña financiera':'Acceso a módulos financieros';
  el('finSecText').textContent=setup?'Esta contraseña protegerá Facturación y Cuentas por Cobrar en este equipo.':change?'Ingrese la contraseña actual y defina la nueva.':'Ingrese la contraseña para abrir Facturación y Cuentas por Cobrar.';
  el('finSecCurrentWrap').style.display=change?'block':'none';
  el('finSecConfirmWrap').style.display=(setup||change)?'block':'none';
  el('finSecSubmit').textContent=setup?'Crear y abrir':change?'Cambiar contraseña':'Desbloquear';
  modal.dataset.mode=mode;modal.classList.add('show');
  setTimeout(()=>el(change?'finSecCurrent':'finSecPassword')?.focus(),30);
}
function hide(result=false){el('financialSecurityModal')?.classList.remove('show');const r=pendingResolve;pendingResolve=null;if(r)r(result)}
function inject(){
  if(el('financialSecurityModal'))return;
  const wrap=document.createElement('div');
  wrap.innerHTML=`<div class="modal" id="financialSecurityModal"><div class="modal-box" style="width:min(480px,100%)"><div class="modal-head"><div><h3 id="finSecTitle">Acceso financiero</h3><div class="muted" id="finSecText"></div></div><button class="close" id="finSecClose" type="button">×</button></div><form id="finSecForm"><div id="finSecCurrentWrap" style="display:none"><label>Contraseña actual</label><input id="finSecCurrent" type="password" autocomplete="current-password"></div><label style="margin-top:10px">Contraseña</label><input id="finSecPassword" type="password" autocomplete="current-password" required><div id="finSecConfirmWrap" style="display:none"><label style="margin-top:10px">Confirmar contraseña</label><input id="finSecConfirm" type="password" autocomplete="new-password"></div><div id="finSecError" style="min-height:20px;margin-top:8px;color:#b42318;font-size:11px;font-weight:800"></div><div class="actions"><button class="btn primary" id="finSecSubmit" type="submit">Desbloquear</button><button class="btn secondary" id="finSecCancel" type="button">Cancelar</button></div><div class="notice" style="margin-top:12px;margin-bottom:0"><b>Seguridad local:</b> la contraseña no se guarda en texto; se conserva únicamente una verificación hash en IndexedDB.</div></form></div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  el('finSecClose').onclick=()=>hide(false);el('finSecCancel').onclick=()=>hide(false);
  el('finSecForm').onsubmit=async e=>{
    e.preventDefault();clearErrors();
    const mode=el('financialSecurityModal').dataset.mode||'unlock';
    const password=el('finSecPassword').value;
    if(password.length<4){error('Use una contraseña de al menos 4 caracteres.');return}
    try{
      if(mode==='setup'){
        if(password!==el('finSecConfirm').value){error('Las contraseñas no coinciden.');return}
        const salt=randomSalt(),hash=await hashPassword(password,salt);await saveRecord({salt,hash});configured=true;unlocked=true;hide(true);return;
      }
      const rec=await record();if(!rec){configured=false;show('setup');return}
      if(mode==='change'){
        const current=el('finSecCurrent').value;if(!current){error('Ingrese la contraseña actual.');return}
        const currentHash=await hashPassword(current,rec.salt);if(currentHash!==rec.hash){error('La contraseña actual no es correcta.');return}
        if(password!==el('finSecConfirm').value){error('Las contraseñas nuevas no coinciden.');return}
        const salt=randomSalt(),hash=await hashPassword(password,salt);await saveRecord({salt,hash});configured=true;unlocked=true;hide(true);return;
      }
      const hash=await hashPassword(password,rec.salt);if(hash!==rec.hash){error('Contraseña incorrecta.');return}
      unlocked=true;hide(true);
    }catch(err){error(err?.message||String(err))}
  };
}
async function ensureConfigured(){configured=!!(await record());return configured}
async function requestAccess(){
  if(unlocked)return true;
  inject();const exists=await ensureConfigured();
  return new Promise(resolve=>{pendingResolve=resolve;show(exists?'unlock':'setup')});
}
function lock(){unlocked=false;document.dispatchEvent(new CustomEvent('pep:financial-lock'));}
async function changePassword(){inject();if(!await ensureConfigured()){return requestAccess()}return new Promise(resolve=>{pendingResolve=resolve;show('change')})}
function isFinancial(moduleId){return FINANCIAL_MODULES.has(moduleId)}
function isUnlocked(){return unlocked}
async function init(){inject();await ensureConfigured();document.querySelectorAll('[data-financial-lock]').forEach(b=>b.addEventListener('click',()=>lock()));document.querySelectorAll('[data-financial-change]').forEach(b=>b.addEventListener('click',()=>changePassword()));}
export const financialSecurity={init,requestAccess,lock,changePassword,isFinancial,isUnlocked};
