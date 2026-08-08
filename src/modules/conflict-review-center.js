import {conflictRepository} from '../data/conflict-repository.js';
import {conflictResolutionManager} from '../sync/conflict-resolution-manager.js';
import {eventBus} from '../core/event-bus.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('es-EC')};
const short=v=>{const s=String(v||'');return s.length>24?`${s.slice(0,12)}…${s.slice(-8)}`:(s||'—')};
const renderVal=v=>{if(v===undefined)return '<span class="muted">(sin valor)</span>';if(v===null)return '<span class="muted">null</span>';if(typeof v==='object')return esc(JSON.stringify(v));return esc(v)};
const pretty=v=>JSON.stringify(v||{},null,2);
const META=new Set(['revision','updatedAt','updatedBy','deviceId','originDeviceId','createdAt','lastLocalChangeAt','lastSyncedAt','syncState','syncSchemaVersion','cloudUpdatedAt','cloudRevision','conflictSchemaVersion']);
function manualDraft(x){
  const base={...(x.remoteSnapshot||{}),...(x.localSnapshot||{})};
  for(const f of (x.differingFields||[])){
    // Para campos realmente disputados no elegimos silenciosamente: por defecto conserva local, visible en el editor.
    if(x.localSnapshot&&Object.prototype.hasOwnProperty.call(x.localSnapshot,f))base[f]=x.localSnapshot[f];
  }
  return base;
}

export class ConflictReviewCenter{
  constructor(){this.rows=[];this.selectedId=null;this.initialized=false;this.busy=false}
  async init(){if(this.initialized)return;this.initialized=true;
    $('conflictRefresh')?.addEventListener('click',()=>this.refresh());
    $('conflictSearch')?.addEventListener('input',()=>this.render());
    $('conflictStatus')?.addEventListener('change',()=>this.render());
    $('conflictDomain')?.addEventListener('change',()=>this.render());
    $('conflictRows')?.addEventListener('click',e=>{const b=e.target.closest('[data-conflict-id]');if(b){this.selectedId=b.dataset.conflictId;this.render()}});
    $('conflictDetail')?.addEventListener('click',e=>this.handleDetailAction(e));
    eventBus.on('conflict:detected',()=>this.refresh());
    eventBus.on('conflict:auto-merged',()=>this.refresh());
    eventBus.on('conflict:manual-resolved',()=>this.refresh());
    await this.refresh();
  }
  async refresh(){this.rows=(await conflictRepository.all()).sort((a,b)=>String(b.detectedAt||'').localeCompare(String(a.detectedAt||'')));this.syncDomainFilter();this.render()}
  syncDomainFilter(){const el=$('conflictDomain');if(!el)return;const current=el.value;const ds=[...new Set(this.rows.map(x=>String(x.domain||'').toUpperCase()).filter(Boolean))].sort();el.innerHTML='<option value="">Todos los dominios</option>'+ds.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');if(ds.includes(current))el.value=current}
  filtered(){const q=String($('conflictSearch')?.value||'').trim().toLowerCase(),st=String($('conflictStatus')?.value||'').toUpperCase(),dom=String($('conflictDomain')?.value||'').toUpperCase();return this.rows.filter(x=>{if(st&&String(x.status||'').toUpperCase()!==st)return false;if(dom&&String(x.domain||'').toUpperCase()!==dom)return false;if(!q)return true;const bag=[x.id,x.entityId,x.entityType,x.domain,x.localDeviceId,x.remoteDeviceId,...(x.differingFields||[])].join(' ').toLowerCase();return bag.includes(q)})}
  render(){const pending=this.rows.filter(x=>String(x.status||'').toUpperCase()==='PENDING').length,resolved=this.rows.length-pending,domains=new Set(this.rows.map(x=>x.domain).filter(Boolean)).size;
    if($('conflictTotal'))$('conflictTotal').textContent=String(this.rows.length);if($('conflictPending'))$('conflictPending').textContent=String(pending);if($('conflictResolved'))$('conflictResolved').textContent=String(resolved);if($('conflictDomains'))$('conflictDomains').textContent=String(domains);if($('countConflicts'))$('countConflicts').textContent=String(pending);
    const rows=this.filtered(),body=$('conflictRows');if(body)body.innerHTML=rows.length?rows.map(x=>`<tr class="${x.id===this.selectedId?'conflict-row-active':''}"><td>${fmt(x.detectedAt)}</td><td><b>${esc(x.domain||'—')}</b><div class="muted">${esc(x.entityType||'—')}</div></td><td><span class="mono">${esc(short(x.entityId))}</span><div class="muted mono">${esc(short(x.id))}</div></td><td>Local <b>${Number(x.localRevision||0)}</b><br>Remoto <b>${Number(x.remoteRevision||0)}</b></td><td>${(x.differingFields||[]).slice(0,4).map(f=>`<span class="badge amber">${esc(f)}</span>`).join(' ')||'—'}${(x.differingFields||[]).length>4?` <span class="muted">+${x.differingFields.length-4}</span>`:''}</td><td><div class="muted">L: ${esc(short(x.localDeviceId))}</div><div class="muted">R: ${esc(short(x.remoteDeviceId))}</div></td><td><span class="badge ${String(x.status).toUpperCase()==='PENDING'?'amber':'green'}">${esc(x.resolution==='AUTO_MERGED'?'AUTO MERGE':(x.resolution||x.status||'—'))}</span></td><td><button class="btn blue small" data-conflict-id="${esc(x.id)}">Comparar</button></td></tr>`).join(''):'<tr><td colspan="8"><div class="empty">No hay conflictos con estos filtros.</div></td></tr>';
    this.renderDetail(this.rows.find(x=>x.id===this.selectedId));
  }
  renderDetail(x){const el=$('conflictDetail');if(!el)return;if(!x){el.innerHTML='<div class="empty">Seleccione un conflicto para comparar la versión local y remota.</div>';return}const fields=x.differingFields||[],pending=String(x.status||'').toUpperCase()==='PENDING';
    const resolvedNotice=!pending?`<div class="notice" style="margin-bottom:10px"><b>✅ Conflicto resuelto.</b> Estrategia: ${esc(x.resolution||'—')} · revisión resultante ${Number(x.resolvedRevision||x.mergedRevision||0)||'—'}.</div>`:'';
    const actions=pending?`<div class="conflict-actions"><button class="btn secondary" data-conflict-action="KEEP_LOCAL">Conservar local</button><button class="btn blue" data-conflict-action="KEEP_REMOTE">Conservar remoto</button><button class="btn" data-conflict-action="OPEN_EDITOR">Fusionar / editar</button></div><div id="conflictManualEditor" style="display:none;margin-top:10px"><label>Snapshot resultante (JSON)</label><textarea id="conflictManualJson" class="conflict-editor" spellcheck="false">${esc(pretty(manualDraft(x)))}</textarea><div class="notice" style="margin:8px 0"><b>Revise antes de guardar.</b> El UUID/ID canónico no puede cambiarse. La resolución se publicará mediante el Outbox normal.</div><div class="actions"><button class="btn secondary" data-conflict-action="CANCEL_EDITOR">Cancelar</button><button class="btn green" data-conflict-action="APPLY_EDITOR">Guardar resolución manual</button></div></div>`:'';
    el.innerHTML=`<h3>Comparación del conflicto</h3><p class="sub">${esc(x.domain)} · ${esc(x.entityType||'Entidad')} · <span class="mono">${esc(x.entityId)}</span></p><div class="notice"><b>V4.5.3 Manual Conflict Resolution:</b> Smart Merge sigue resolviendo únicamente cambios no superpuestos. Los conflictos pendientes pueden resolverse aquí sin escribir directamente en Firestore.</div>${resolvedNotice}<div class="grid" style="margin-bottom:10px"><div class="w6"><label>Revisión local</label><div class="matrix-info">${Number(x.localRevision||0)}</div></div><div class="w6"><label>Revisión remota</label><div class="matrix-info">${Number(x.remoteRevision||0)}</div></div><div class="w6"><label>Device local</label><div class="matrix-info mono">${esc(x.localDeviceId||'—')}</div></div><div class="w6"><label>Device remoto</label><div class="matrix-info mono">${esc(x.remoteDeviceId||'—')}</div></div></div>${actions}<h4>Campos diferentes (${fields.length})</h4>${fields.length?`<div class="conflict-diff"><div class="head">Campo</div><div class="head">Versión local</div><div class="head">Versión remota</div>${fields.map(f=>`<div class="conflict-field">${esc(f)}</div><div>${renderVal(x.localSnapshot?.[f])}</div><div>${renderVal(x.remoteSnapshot?.[f])}</div>`).join('')}</div>`:'<div class="notice">No hay campos de negocio diferentes registrados.</div>'}<details style="margin-top:12px"><summary><b>Snapshot local completo</b></summary><div class="conflict-json" style="margin-top:7px">${esc(pretty(x.localSnapshot))}</div></details><details style="margin-top:8px"><summary><b>Snapshot remoto completo</b></summary><div class="conflict-json" style="margin-top:7px">${esc(pretty(x.remoteSnapshot))}</div></details>`}
  async handleDetailAction(e){const btn=e.target.closest('[data-conflict-action]');if(!btn||this.busy)return;const action=btn.dataset.conflictAction,x=this.rows.find(r=>r.id===this.selectedId);if(!x)return;
    if(action==='OPEN_EDITOR'){const box=$('conflictManualEditor');if(box)box.style.display='block';return}
    if(action==='CANCEL_EDITOR'){const box=$('conflictManualEditor');if(box)box.style.display='none';return}
    let strategy=action,snapshot=null;
    if(action==='APPLY_EDITOR'){strategy='EDITED';try{snapshot=JSON.parse($('conflictManualJson')?.value||'{}')}catch(err){alert(`JSON inválido: ${err.message}`);return}}
    if(!['KEEP_LOCAL','KEEP_REMOTE','EDITED'].includes(strategy))return;
    const label=strategy==='KEEP_LOCAL'?'conservar la versión LOCAL':strategy==='KEEP_REMOTE'?'conservar la versión REMOTA':'guardar la versión editada/fusionada';
    if(!confirm(`¿Confirma ${label}?\n\nSe creará una nueva revisión y se enviará por el Outbox normal.`))return;
    this.busy=true;try{await conflictResolutionManager.resolveManual({conflictId:x.id,strategy,editedSnapshot:snapshot});await this.refresh();alert('Conflicto resuelto. La nueva revisión quedó en el flujo normal de sincronización.')}catch(err){alert(`No se pudo resolver: ${err.message||err}`)}finally{this.busy=false}
  }
}
export const conflictReviewCenter=new ConflictReviewCenter();
