import {outboxRepository} from '../data/outbox-repository.js';
import {eventBus} from '../core/event-bus.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const upper=v=>String(v||'').toUpperCase();
const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('es-EC')};
const acked=x=>!!x?.ackedAt||['ACKED','ACK_SUPERSEDED','PROCESSED','SENT'].includes(upper(x?.status));
const validDomains=new Set(['SAMPLES','LABORATORY','REPORTS','BILLING','RECEIVABLES','CLIENTS','CATALOGS']);
const validOps=new Set(['UPSERT','DELETE']);
function orphanReason(x){
  if(!x?.id)return 'Sin UUID de Outbox';
  if(!validDomains.has(upper(x.domain)))return 'Dominio inválido';
  if(!validOps.has(upper(x.operation)))return 'Operación inválida';
  if(!String(x.entityId||'').trim())return 'Sin entityId';
  if(upper(x.operation)==='UPSERT'&&!x.payload)return 'UPSERT sin payload';
  return '';
}
export class OutboxInspector{
  constructor(){this.$=id=>document.getElementById(id);this.unsubscribe=null}
  init(){
    this.$('outboxInspectorRefresh')?.addEventListener('click',()=>this.refresh());
    this.$('outboxInspectorRows')?.addEventListener('click',e=>this.handleAction(e));
    this.unsubscribe=eventBus.on('outbox:changed',()=>this.refresh().catch(()=>{}));
    return this.refresh();
  }
  async refresh(){
    const rows=(await outboxRepository.all()).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
    const pending=rows.filter(x=>['PENDING','ERROR'].includes(upper(x.status))).length;
    const errors=rows.filter(x=>upper(x.status)==='ERROR').length;
    const ack=rows.filter(acked).length;
    const orphan=rows.filter(x=>!!orphanReason(x)).length;
    if(this.$('outboxInspectorTotal'))this.$('outboxInspectorTotal').textContent=rows.length;
    if(this.$('outboxInspectorPending'))this.$('outboxInspectorPending').textContent=pending;
    if(this.$('outboxInspectorErrors'))this.$('outboxInspectorErrors').textContent=errors;
    if(this.$('outboxInspectorAck'))this.$('outboxInspectorAck').textContent=ack;
    if(this.$('outboxInspectorOrphans'))this.$('outboxInspectorOrphans').textContent=orphan;
    const body=this.$('outboxInspectorRows');if(!body)return rows;
    body.innerHTML=rows.length?rows.map(x=>{
      const orphan=orphanReason(x),hasAck=acked(x),canRetry=upper(x.status)==='ERROR',canProcess=hasAck,canRemove=!!orphan;
      return `<tr>
        <td><b class="mono">${esc(x.id)}</b><div class="muted">Entidad: <span class="mono">${esc(x.entityId||'—')}</span></div></td>
        <td><b>${esc(upper(x.domain)||'—')}</b><div class="muted">${esc(x.entityType||'—')}</div></td>
        <td><span class="badge ${upper(x.operation)==='DELETE'?'red':'blue'}">${esc(upper(x.operation)||'—')}</span></td>
        <td><span class="badge ${upper(x.status)==='ERROR'?'red':upper(x.status)==='PENDING'?'amber':'green'}">${esc(upper(x.status)||'—')}</span></td>
        <td>${fmt(x.createdAt)}<div class="muted">Act.: ${fmt(x.updatedAt)}</div></td>
        <td>${Number(x.attempts||0)}</td>
        <td>${x.lastError?`<span style="color:#a11">${esc(x.lastError)}</span>`:'—'}${orphan?`<div class="muted" style="color:#a11">Huérfano: ${esc(orphan)}</div>`:''}</td>
        <td><span class="badge ${hasAck?'green':'amber'}">${hasAck?'SÍ':'NO'}</span>${x.ackedAt?`<div class="muted">${fmt(x.ackedAt)}</div>`:''}</td>
        <td><div class="actions" style="margin:0;gap:5px;flex-wrap:wrap">
          ${canRetry?`<button class="btn blue small" data-outbox-retry="${esc(x.id)}">Reintentar</button>`:''}
          ${canProcess?`<button class="btn secondary small" data-outbox-processed="${esc(x.id)}">Marcar procesado</button>`:''}
          ${canRemove?`<button class="btn danger small" data-outbox-orphan="${esc(x.id)}">Eliminar huérfano</button>`:''}
          ${(!canRetry&&!canProcess&&!canRemove)?'<span class="muted">Solo inspección</span>':''}
        </div></td>
      </tr>`
    }).join(''):'<tr><td colspan="9"><div class="empty">Outbox vacío. No existen operaciones almacenadas.</div></td></tr>';
    const info=this.$('outboxInspectorInfo');if(info)info.innerHTML=`<div class="notice ${pending?'warn':''}"><b>${pending?'⚠️':'✅'} Outbox Inspector:</b> ${rows.length} registro(s) almacenados · ${pending} realmente pendiente(s) · ${errors} error(es). El Inspector no hace push directo a Firestore.</div>`;
    return rows;
  }
  async handleAction(e){
    const retry=e.target.closest('[data-outbox-retry]');
    const processed=e.target.closest('[data-outbox-processed]');
    const orphan=e.target.closest('[data-outbox-orphan]');
    try{
      if(retry){await outboxRepository.resetForRetry(retry.dataset.outboxRetry);await this.refresh();return}
      if(processed){
        const id=processed.dataset.outboxProcessed;
        const row=(await outboxRepository.all()).find(x=>x.id===id);
        if(!row||!acked(row))throw new Error('No existe evidencia local de ACK para este registro.');
        await outboxRepository.removeInspected(id,'MANUAL_PROCESSED_ACK');await this.refresh();return;
      }
      if(orphan){
        const id=orphan.dataset.outboxOrphan;
        const row=(await outboxRepository.all()).find(x=>x.id===id);
        const reason=orphanReason(row);if(!reason)throw new Error('El registro ya no cumple criterios de huérfano.');
        if(!confirm(`Eliminar únicamente este registro inválido del Outbox?\n\nMotivo: ${reason}\n\nNo se eliminará ninguna muestra ni documento de Firestore.`))return;
        await outboxRepository.removeInspected(id,'MANUAL_ORPHAN_REMOVE');await this.refresh();
      }
    }catch(err){const info=this.$('outboxInspectorInfo');if(info)info.innerHTML=`<div class="notice warn"><b>Outbox Inspector:</b> ${esc(err.message||err)}</div>`}
  }
}
export const outboxInspector=new OutboxInspector();
