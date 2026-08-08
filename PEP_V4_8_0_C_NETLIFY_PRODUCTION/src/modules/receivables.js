import {repositories} from '../data/repositories.js';
import {eventBus} from '../core/event-bus.js';

const clean=v=>String(v??'').trim();
const n=v=>{const x=Number(v||0);return Number.isFinite(x)?x:0};
const nowIso=()=>new Date().toISOString();
const stableId=(prefix,parent)=>`${prefix}_${clean(parent).replace(/[^A-Za-z0-9_-]/g,'_')}`;
const round2=v=>Math.round((n(v)+Number.EPSILON)*100)/100;
function addDays(dateStr,days){if(!dateStr)return '';const d=new Date(`${dateStr}T12:00:00`);if(Number.isNaN(d.getTime()))return '';d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10)}
function history(rec,action,userId,detail=''){return [...(rec?.history||[]),{action,at:nowIso(),userId,detail}]}
export const RECEIVABLE_STATUSES=['PENDIENTE','CRÉDITO','PARCIAL','PAGADO','ANULADO'];
export function receivableTotals(r){
  const subtotal=round2(r.subtotal),ivaRate=Math.max(0,n(r.ivaRate)),iva=round2(subtotal*ivaRate/100),total=round2(subtotal+iva),paid=round2(r.amountPaid),ret=round2(r.retentions),nc=round2(r.creditNotes),balance=round2(Math.max(0,total-paid-ret-nc));
  return {subtotal,ivaRate,iva,total,paid,retentions:ret,creditNotes:nc,balance};
}
export function receivableDisplayStatus(r){
  if(r.collectionStatus==='ANULADO')return 'ANULADO';
  const t=receivableTotals(r);
  if(t.total>0&&t.balance<=0.009)return 'PAGADO';
  if(t.paid+t.retentions+t.creditNotes>0)return 'PARCIAL';
  const today=new Date();today.setHours(0,0,0,0);
  if(r.dueDate){const d=new Date(`${r.dueDate}T00:00:00`);if(!Number.isNaN(d.getTime())&&d<today)return 'VENCIDO'}
  return r.collectionStatus==='CRÉDITO'?'CRÉDITO':'PENDIENTE';
}
class ReceivablesService{
  constructor(){this._ensurePromise=null;this._reconcilePromise=null}
  async all(){return repositories.receivables.all()}
  async ensureFromBilling({userId='SYSTEM'}={}){
    if(this._ensurePromise)return this._ensurePromise;
    this._ensurePromise=(async()=>{
    const [billing,existing,samples]=await Promise.all([repositories.billing.all(),repositories.receivables.all(),repositories.samples.all()]);
    const activeSampleIds=new Set(samples.map(x=>x.id));
    const byBilling=new Map(existing.map(r=>[r.billingId,r]));let created=0,updated=0;
    for(const b of billing){
      if(!activeSampleIds.has(b.sampleId)||b.billingStatus!=='FACTURADO'||!clean(b.invoice)||!clean(b.invoiceDate))continue;
      const current=byBilling.get(b.id);
      const technical={billingId:b.id,sampleId:b.sampleId,labEntryId:b.labEntryId,reportId:b.reportId||'',code:b.code,year:b.year,codeFull:b.codeFull,clientId:b.clientId,branch:b.branch,matrixId:b.matrixId,groupId:b.groupId,analyst:b.analyst,serviceType:b.serviceType,quotation:b.quotation||'',invoice:b.invoice,invoiceDate:b.invoiceDate,subtotal:round2(b.subtotal),billingStatus:b.billingStatus,billingUpdatedAt:b.billingUpdatedAt||b.updatedAt};
      if(!current){
        const creditDays=0,dueDate=addDays(b.invoiceDate,creditDays);
        await repositories.receivables.create({id:stableId('RECEIVABLE',b.id),schemaVersion:1,...technical,ivaRate:15,creditDays,dueDate,paymentDate:'',amountPaid:0,retentions:0,creditNotes:0,collectionStatus:'PENDIENTE',collectionObservation:'',collectionUpdatedAt:'',history:[{action:'RECEIVABLE_CREATED_FROM_BILLING',at:nowIso(),userId,detail:`Factura ${b.invoice} recibida desde Facturación`} ]},{userId});created++;
      }else{
        const patch={};for(const [k,v] of Object.entries(technical))if((current[k]??'')!==(v??''))patch[k]=v;
        if(current.invoiceDate!==b.invoiceDate&&!current.dueDate)patch.dueDate=addDays(b.invoiceDate,current.creditDays||0);
        if(Object.keys(patch).length){await repositories.receivables.update(current.id,patch,{userId});updated++}
      }
    }
    return {created,updated};
    })();
    try{return await this._ensurePromise}finally{this._ensurePromise=null}
  }
  async reconcileDuplicates({userId='SYSTEM_IDENTITY_REPAIR'}={}){
    if(this._reconcilePromise)return this._reconcilePromise;
    this._reconcilePromise=(async()=>{const rows=await repositories.receivables.all(),groups=new Map();for(const r of rows){const key=r.billingId||r.sampleId;if(!key)continue;const a=groups.get(key)||[];a.push(r);groups.set(key,a)}let fixed=0;const rank=r=>({PENDIENTE:1,'CRÉDITO':2,PARCIAL:3,PAGADO:4,ANULADO:5}[r.collectionStatus]||0)*100+(Number(r.amountPaid||0)>0?30:0)+Number(r.revision||0)/1000;for(const [,list] of groups){if(list.length<2)continue;list.sort((a,b)=>rank(b)-rank(a)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||String(a.id).localeCompare(String(b.id)));for(const dup of list.slice(1)){await repositories.receivables.softDelete(dup.id,{userId,sync:true});fixed++}}return {fixed};})();
    try{return await this._reconcilePromise}finally{this._reconcilePromise=null}
  }
  async save(id,data,{userId='LOCAL_USER'}={}){
    const rec=await repositories.receivables.get(id);if(!rec)throw new Error('Registro de cobranza no encontrado.');
    let status=clean(data.collectionStatus)||'PENDIENTE';if(!RECEIVABLE_STATUSES.includes(status))throw new Error('Estado de cobranza no válido.');
    const ivaRate=Math.max(0,n(data.ivaRate)),creditDays=Math.max(0,Math.round(n(data.creditDays))),amountPaid=Math.max(0,n(data.amountPaid)),retentions=Math.max(0,n(data.retentions)),creditNotes=Math.max(0,n(data.creditNotes));
    const dueDate=clean(data.dueDate)||addDays(rec.invoiceDate,creditDays),paymentDate=clean(data.paymentDate),tmp={...rec,ivaRate,creditDays,dueDate,amountPaid,retentions,creditNotes,collectionStatus:status};const totals=receivableTotals(tmp);
    if(status!=='ANULADO'){
      if(totals.total>0&&totals.balance<=0.009)status='PAGADO';else if(totals.paid+totals.retentions+totals.creditNotes>0)status='PARCIAL';
    }
    const patch={ivaRate,creditDays,dueDate,paymentDate,amountPaid:round2(amountPaid),retentions:round2(retentions),creditNotes:round2(creditNotes),collectionStatus:status,collectionObservation:clean(data.collectionObservation),collectionUpdatedAt:nowIso(),history:history(rec,'RECEIVABLE_UPDATED',userId,`${status} · Pagado $${round2(amountPaid).toFixed(2)} · Saldo $${totals.balance.toFixed(2)}`)};
    const after=await repositories.receivables.update(id,patch,{userId});eventBus.emit('receivable.updated',{receivableId:id,billingId:after.billingId,status:receivableDisplayStatus(after)});return after;
  }
}
export const receivablesService=new ReceivablesService();
