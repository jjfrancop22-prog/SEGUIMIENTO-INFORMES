import {repositories} from '../data/repositories.js';
import {eventBus} from '../core/event-bus.js';

const clean=v=>String(v??'').trim();
const upper=v=>clean(v).toUpperCase();
const stableId=(prefix,parent)=>`${prefix}_${clean(parent).replace(/[^A-Za-z0-9_-]/g,'_')}`;
const nowIso=()=>new Date().toISOString();
const today=()=>new Date().toISOString().slice(0,10);
function reportHistory(report,action,userId,detail=''){
  return [...(report?.history||[]),{action,at:nowIso(),userId,detail}];
}
export const AUTHORIZATION_LABELS={
  '1':'1 · INFORMES LISTOS',
  '2':'2 · INFORMES RETENIDOS',
  '3':'3 · TRABAJO SIN OC/FACTURACIÓN Y COMERCIAL EN SEGUIMIENTO',
  '4':'4 · PROYECTO FT'
};
export const AUTHORIZATION_HOLD_STATUSES=new Set(['2','3']);
export const isAuthorizationHold=status=>AUTHORIZATION_HOLD_STATUSES.has(clean(status));

class ReportsService{
  constructor(){this._ensurePromise=null;this._reconcilePromise=null}
  async all(){return repositories.reports.all()}
  async ensureFromLaboratory({userId='SYSTEM'}={}){
    if(this._ensurePromise)return this._ensurePromise;
    this._ensurePromise=(async()=>{
    const [labs,reports,samples]=await Promise.all([repositories.laboratory.all(),repositories.reports.all(),repositories.samples.all()]);
    const activeSampleIds=new Set(samples.map(x=>x.id));
    const existing=new Set(reports.map(r=>r.labEntryId));
    let created=0;
    for(const lab of labs){
      if(!lab.officialEntryAt||!activeSampleIds.has(lab.sampleId)||existing.has(lab.id))continue;
      await repositories.reports.create({
        id:stableId('REPORT',lab.id),
        schemaVersion:1,
        sampleId:lab.sampleId,
        labEntryId:lab.id,
        code:lab.code,
        year:lab.year,
        codeFull:lab.codeFull,
        clientId:lab.clientId,
        branch:lab.branch,
        matrixId:lab.matrixId,
        groupId:lab.groupId,
        analyst:lab.analyst,
        serviceType:lab.serviceType,
        receptionDate:lab.receptionDate,
        maxReportDate:lab.maxReportDate,
        reportStatus:'PENDING_DELIVERY',
        realDeliveryDate:'',
        authorizationStatus:'',
        authorizationDate:'',
        portalSentDate:'',
        portalSentAt:'',
        history:[{action:'REPORT_CREATED_FROM_LAB',at:nowIso(),userId,detail:'Informe creado automáticamente desde ingreso oficial de Laboratorio'}]
      },{userId});
      existing.add(lab.id);created++;
    }
    return created;
    })();
    try{return await this._ensurePromise}finally{this._ensurePromise=null}
  }
  async reconcileDuplicates({userId='SYSTEM_IDENTITY_REPAIR'}={}){
    if(this._reconcilePromise)return this._reconcilePromise;
    this._reconcilePromise=(async()=>{
      const rows=await repositories.reports.all();const groups=new Map();
      for(const r of rows){const key=r.sampleId||r.labEntryId;if(!key)continue;const a=groups.get(key)||[];a.push(r);groups.set(key,a)}
      let fixed=0;
      const rank=r=>{const stage={PENDING_DELIVERY:10,AUTHORIZATION:30,PORTAL_PENDING:60,PORTAL_SENT:100}[r.reportStatus]||0;return stage+(r.realDeliveryDate?5:0)+(r.authorizationDate?10:0)+(r.portalSentDate?20:0)+Number(r.revision||0)/1000};
      for(const [,list] of groups){if(list.length<2)continue;list.sort((a,b)=>rank(b)-rank(a)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||String(a.id).localeCompare(String(b.id)));const keep=list[0];
        const histories=[];for(const x of list)for(const h of (x.history||[]))histories.push(h);
        const uniq=[...new Map(histories.map(h=>[`${h.action}|${h.at}|${h.userId}|${h.detail}`,h])).values()].sort((a,b)=>String(a.at||'').localeCompare(String(b.at||'')));
        if(uniq.length!==(keep.history||[]).length)await repositories.reports.update(keep.id,{history:uniq},{userId,sync:true});
        for(const dup of list.slice(1)){await repositories.reports.softDelete(dup.id,{userId,sync:true});fixed++}
      }
      return {fixed};
    })();
    try{return await this._reconcilePromise}finally{this._reconcilePromise=null}
  }
  async saveRealDelivery(reportId,date,{userId='LOCAL_USER'}={}){
    const report=await repositories.reports.get(reportId);if(!report)throw new Error('Informe no encontrado.');
    const value=clean(date);if(!value)throw new Error('Seleccione la fecha real de entrega.');
    if(report.reportStatus!=='PENDING_DELIVERY'&&report.reportStatus!=='AUTHORIZATION')throw new Error('Este informe ya avanzó a otra etapa.');
    const after=await repositories.reports.update(reportId,{
      realDeliveryDate:value,
      reportStatus:'AUTHORIZATION',
      history:reportHistory(report,'REAL_DELIVERY_REGISTERED',userId,`Fecha real de entrega: ${value}`)
    },{userId});
    eventBus.emit('reports.delivery.completed',{reportId,sampleId:after.sampleId,date:value});
    return after;
  }
  async saveAuthorization(reportId,{status,date},{userId='LOCAL_USER'}={}){
    const report=await repositories.reports.get(reportId);if(!report)throw new Error('Informe no encontrado.');
    if(report.reportStatus!=='AUTHORIZATION'&&report.reportStatus!=='PORTAL_PENDING')throw new Error('El informe no está en Autorización.');
    const s=clean(status);if(!AUTHORIZATION_LABELS[s])throw new Error('Seleccione un estado de autorización del 1 al 4.');

    // Estados 2 y 3 son estados de retención/seguimiento: se guardan sin fecha
    // y permanecen en la bandeja de Autorización para poder cambiarse después.
    if(isAuthorizationHold(s)){
      const after=await repositories.reports.update(reportId,{
        authorizationStatus:s,
        authorizationDate:'',
        reportStatus:'AUTHORIZATION',
        history:reportHistory(report,'AUTHORIZATION_HOLD_SAVED',userId,AUTHORIZATION_LABELS[s])
      },{userId});
      eventBus.emit('reports.authorization.hold',{reportId,sampleId:after.sampleId,status:s});
      return after;
    }

    // Estados 1 y 4 sí representan salida de Autorización hacia Portal.
    const d=clean(date);if(!d)throw new Error('Seleccione la fecha de autorización para este estado.');
    const after=await repositories.reports.update(reportId,{
      authorizationStatus:s,
      authorizationDate:d,
      reportStatus:'PORTAL_PENDING',
      history:reportHistory(report,'REPORT_AUTHORIZED',userId,`${AUTHORIZATION_LABELS[s]} · ${d}`)
    },{userId});
    eventBus.emit('reports.authorization.completed',{reportId,sampleId:after.sampleId,status:s,date:d});
    return after;
  }
  async reconcileAuthorizationHolds({userId='SYSTEM'}={}){
    const reports=await repositories.reports.all();
    let fixed=0;
    for(const report of reports){
      if(!isAuthorizationHold(report.authorizationStatus))continue;
      if(report.reportStatus!=='PORTAL_PENDING'||report.portalSentDate)continue;
      await repositories.reports.update(report.id,{
        authorizationDate:'',
        reportStatus:'AUTHORIZATION',
        history:reportHistory(report,'AUTHORIZATION_HOLD_RECONCILED',userId,'Estado 2/3 restaurado a bandeja Autorización')
      },{userId});
      fixed++;
    }
    return fixed;
  }
  async sendToPortal(reportId,date,{userId='LOCAL_USER'}={}){
    const report=await repositories.reports.get(reportId);if(!report)throw new Error('Informe no encontrado.');
    if(report.reportStatus!=='PORTAL_PENDING'&&report.reportStatus!=='PORTAL_SENT')throw new Error('El informe no está pendiente de Portal.');
    const d=clean(date)||today();
    const after=await repositories.reports.update(reportId,{
      portalSentDate:d,
      portalSentAt:nowIso(),
      reportStatus:'PORTAL_SENT',
      history:reportHistory(report,'REPORT_SENT_TO_PORTAL',userId,`Enviado al Portal Cliente: ${d}`)
    },{userId});
    eventBus.emit('reports.portal.completed',{reportId,sampleId:after.sampleId,date:d});
    return after;
  }
  async updateAnalystFromLab(){
    const [labs,reports]=await Promise.all([repositories.laboratory.all(),repositories.reports.all()]);
    const labById=new Map(labs.map(l=>[l.id,l]));
    for(const r of reports){
      const lab=labById.get(r.labEntryId);
      if(lab&&lab.analyst!==r.analyst)await repositories.reports.update(r.id,{analyst:lab.analyst},{userId:'SYSTEM'});
    }
  }
}
export const reportsService=new ReportsService();
