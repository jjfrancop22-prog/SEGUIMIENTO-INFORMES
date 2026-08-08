import {repositories} from '../data/repositories.js';
import {eventBus} from '../core/event-bus.js';

const STAGE_ORDER={MONITORING:0,LABORATORY:1,REPORTS_PENDING:2,AUTHORIZATION:3,PORTAL:4,BILLING:5,RECEIVABLES:6};
export const STAGE_LABELS={
  MONITORING:'MONITOREO / REGISTRO DE MUESTRAS',
  LABORATORY:'LABORATORIO',
  REPORTS_PENDING:'INFORMES PENDIENTES',
  AUTHORIZATION:'AUTORIZACIÓN',
  PORTAL:'PORTAL CLIENTE',
  BILLING:'FACTURACIÓN',
  RECEIVABLES:'CUENTAS POR COBRAR'
};

class LifecycleDeleteService{
  async linked(sampleId){
    const [samples,labs,reports,billing,receivables]=await Promise.all([
      repositories.samples.all({includeDeleted:true}),
      repositories.laboratory.all({includeDeleted:true}),
      repositories.reports.all({includeDeleted:true}),
      repositories.billing.all({includeDeleted:true}),
      repositories.receivables.all({includeDeleted:true})
    ]);
    const sample=samples.find(x=>x.id===sampleId&&!x.deleted)||null;
    const lab=labs.find(x=>x.sampleId===sampleId&&!x.deleted)||null;
    const report=reports.find(x=>x.sampleId===sampleId&&!x.deleted)||null;
    const bill=billing.find(x=>x.sampleId===sampleId&&!x.deleted)||null;
    const recv=receivables.find(x=>x.sampleId===sampleId&&!x.deleted)||null;
    return {sample,lab,report,bill,recv};
  }
  async currentStage(sampleId){
    const x=await this.linked(sampleId);
    if(!x.sample)throw new Error('La muestra ya no existe o fue eliminada.');
    if(x.recv)return {stage:'RECEIVABLES',...x};
    if(x.report){
      if(x.report.reportStatus==='PORTAL_SENT')return {stage:'BILLING',...x};
      if(x.report.reportStatus==='PORTAL_PENDING')return {stage:'PORTAL',...x};
      if(x.report.reportStatus==='AUTHORIZATION')return {stage:'AUTHORIZATION',...x};
      if(x.report.reportStatus==='PENDING_DELIVERY')return {stage:'REPORTS_PENDING',...x};
    }
    // Billing puede existir como registro técnico desde Laboratorio; solo manda la etapa
    // cuando ya tiene actividad administrativa real y no existe un reporte que marque una etapa anterior.
    if(x.bill){
      const activeBilling=!!String(x.bill.invoice||x.bill.quotation||x.bill.billingObservation||'').trim() || Number(x.bill.subtotal||0)>0 || !['','PENDIENTE'].includes(String(x.bill.billingStatus||''));
      if(activeBilling)return {stage:'BILLING',...x};
    }
    if(x.lab)return {stage:'LABORATORY',...x};
    return {stage:'MONITORING',...x};
  }
  label(stage){return STAGE_LABELS[stage]||stage}
  async canDeleteFrom(sampleId,requestedStage){
    const state=await this.currentStage(sampleId);
    return {allowed:state.stage===requestedStage,currentStage:state.stage,currentLabel:this.label(state.stage),requestedLabel:this.label(requestedStage),state};
  }
  async deleteFromCurrentStage(sampleId,requestedStage,{userId='LOCAL_USER'}={}){
    if(!(requestedStage in STAGE_ORDER))throw new Error('Etapa de eliminación no reconocida.');
    const check=await this.canDeleteFrom(sampleId,requestedStage);
    if(!check.allowed){
      throw new Error(`Este código ya avanzó a ${check.currentLabel}. Para no romper el flujo, elimínelo únicamente desde esa etapa.`);
    }
    const {sample,lab,report,bill,recv}=check.state;
    const code=sample?.codeFull||`${sample?.code||''}${sample?.year?' · '+sample.year:''}`;
    // Borrado coordinado de la etapa más avanzada hacia el origen.
    if(recv)await repositories.receivables.softDelete(recv.id,{userId});
    if(bill)await repositories.billing.softDelete(bill.id,{userId});
    if(report)await repositories.reports.softDelete(report.id,{userId});
    if(lab)await repositories.laboratory.softDelete(lab.id,{userId});
    if(sample)await repositories.samples.softDelete(sample.id,{userId});
    eventBus.emit('lifecycle.safe-delete.completed',{sampleId,code,stage:requestedStage,userId});
    return {sampleId,code,stage:requestedStage,label:this.label(requestedStage)};
  }
}
export const lifecycleDeleteService=new LifecycleDeleteService();
