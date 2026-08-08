import {repositories} from '../data/repositories.js';
import {eventBus} from '../core/event-bus.js';

const clean=v=>String(v??'').trim();
const nowIso=()=>new Date().toISOString();
const stableId=(prefix,parent)=>`${prefix}_${clean(parent).replace(/[^A-Za-z0-9_-]/g,'_')}`;
function history(rec,action,userId,detail=''){
  return [...(rec?.history||[]),{action,at:nowIso(),userId,detail}];
}
export const BILLING_STATUSES=['PENDIENTE','FACTURADO','FACTURA PARCIAL','EN ESPERA','NO FACTURAR'];

class BillingService{
  constructor(){this._ensurePromise=null;this._reconcilePromise=null}
  async all(){return repositories.billing.all()}
  async ensureFromLaboratory({userId='SYSTEM'}={}){
    if(this._ensurePromise)return this._ensurePromise;
    this._ensurePromise=(async()=>{
    const [labs,billing,reports,samples]=await Promise.all([
      repositories.laboratory.all(),repositories.billing.all(),repositories.reports.all(),repositories.samples.all()
    ]);
    const activeSampleIds=new Set(samples.map(x=>x.id));
    const existing=new Map(billing.map(b=>[b.labEntryId,b]));
    const reportByLab=new Map(reports.map(r=>[r.labEntryId,r]));
    let created=0,updated=0;
    for(const lab of labs){
      if(!lab.officialEntryAt||!activeSampleIds.has(lab.sampleId))continue;
      const report=reportByLab.get(lab.id);
      const current=existing.get(lab.id);
      const technical={
        sampleId:lab.sampleId,labEntryId:lab.id,reportId:report?.id||'',
        code:lab.code,year:lab.year,codeFull:lab.codeFull,
        clientId:lab.clientId,branch:lab.branch,matrixId:lab.matrixId,groupId:lab.groupId,
        analyst:lab.analyst,serviceType:lab.serviceType,receptionDate:lab.receptionDate,
        maxReportDate:lab.maxReportDate,realDeliveryDate:report?.realDeliveryDate||'',
        authorizationStatus:report?.authorizationStatus||'',authorizationDate:report?.authorizationDate||'',
        portalSentDate:report?.portalSentDate||'',reportStatus:report?.reportStatus||''
      };
      if(!current){
        await repositories.billing.create({
          id:stableId('BILLING',lab.id),schemaVersion:1,...technical,
          quotation:'',invoice:'',invoiceDate:'',subtotal:0,
          billingStatus:'PENDIENTE',billingObservation:'',billingUpdatedAt:'',
          history:[{action:'BILLING_CREATED_FROM_LAB',at:nowIso(),userId,detail:'Registro de facturación creado desde ingreso oficial de Laboratorio'}]
        },{userId});created++;
      }else{
        const patch={};
        for(const [k,v] of Object.entries(technical))if((current[k]??'')!==(v??''))patch[k]=v;
        if(Object.keys(patch).length){await repositories.billing.update(current.id,patch,{userId});updated++}
      }
    }
    return {created,updated};
    })();
    try{return await this._ensurePromise}finally{this._ensurePromise=null}
  }
  async reconcileDuplicates({userId='SYSTEM_IDENTITY_REPAIR'}={}){
    if(this._reconcilePromise)return this._reconcilePromise;
    this._reconcilePromise=(async()=>{const rows=await repositories.billing.all(),groups=new Map();for(const r of rows){const key=r.sampleId||r.labEntryId;if(!key)continue;const a=groups.get(key)||[];a.push(r);groups.set(key,a)}let fixed=0;
      const rank=r=>({PENDIENTE:1,'EN ESPERA':2,'NO FACTURAR':3,'FACTURA PARCIAL':4,FACTURADO:5}[r.billingStatus]||0)*100+(r.invoice?30:0)+(Number(r.subtotal||0)>0?20:0)+Number(r.revision||0)/1000;
      for(const [,list] of groups){if(list.length<2)continue;list.sort((a,b)=>rank(b)-rank(a)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||String(a.id).localeCompare(String(b.id)));const keep=list[0];for(const dup of list.slice(1)){await repositories.billing.softDelete(dup.id,{userId,sync:true});fixed++}}return {fixed};})();
    try{return await this._reconcilePromise}finally{this._reconcilePromise=null}
  }
  async save(id,data,{userId='LOCAL_USER'}={}){
    const rec=await repositories.billing.get(id);if(!rec)throw new Error('Registro de facturación no encontrado.');
    const status=clean(data.billingStatus)||'PENDIENTE';
    if(!BILLING_STATUSES.includes(status))throw new Error('Estado de facturación no válido.');
    const subtotal=Number(data.subtotal||0);
    if(!Number.isFinite(subtotal)||subtotal<0)throw new Error('El subtotal no es válido.');
    const patch={
      quotation:clean(data.quotation),invoice:clean(data.invoice),invoiceDate:clean(data.invoiceDate),
      subtotal,billingStatus:status,billingObservation:clean(data.billingObservation),billingUpdatedAt:nowIso(),
      history:history(rec,'BILLING_UPDATED',userId,`${status}${clean(data.invoice)?' · Factura: '+clean(data.invoice):''}${subtotal?' · Subtotal: $'+subtotal.toFixed(2):''}${clean(data.billingObservation)?' · Obs.: '+clean(data.billingObservation):''}`)
    };
    const after=await repositories.billing.update(id,patch,{userId});
    eventBus.emit('billing.updated',{billingId:id,sampleId:after.sampleId,status});
    return after;
  }
}
export const billingService=new BillingService();
