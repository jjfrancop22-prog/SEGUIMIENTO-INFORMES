import {repositories} from '../data/repositories.js';
import {eventBus} from '../core/event-bus.js';

const clean=v=>String(v??'').trim();
const upper=v=>clean(v).toUpperCase();
const stableId=(prefix,parent)=>`${prefix}_${clean(parent).replace(/[^A-Za-z0-9_-]/g,'_')}`;
const isoDate=()=>new Date().toISOString().slice(0,10);
function addDays(date,days){if(!date)return '';const d=new Date(`${date}T12:00:00`);if(Number.isNaN(d.getTime()))return '';d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10)}
function monthName(date){if(!date)return '';const d=new Date(`${date}T12:00:00`);if(Number.isNaN(d.getTime()))return '';return d.toLocaleDateString('es-EC',{month:'long'}).toUpperCase()}
function labHistory(entry,action,userId,detail=''){return [...(entry?.history||[]),{action,at:new Date().toISOString(),userId,detail}]}

class LaboratoryService{
  constructor(){this._reconcilePromise=null}
  async samples(){return repositories.samples.all()}
  async entries(){const [entries,samples]=await Promise.all([repositories.laboratory.all(),repositories.samples.all()]);const active=new Set(samples.map(x=>x.id));return entries.filter(x=>!x.sampleId||active.has(x.sampleId))}
  async eligibleSamples(){
    const [samples,entries]=await Promise.all([this.samples(),this.entries()]);
    const official=new Set(entries.filter(x=>x.officialEntryAt).map(x=>x.sampleId));
    return samples.filter(x=>x.workflow?.workflowStage==='SAMPLE_REGISTRY' && x.workflow?.recordStatus==='INGRESADA' && !official.has(x.id));
  }
  async entryBySample(sampleId){return (await this.entries()).find(x=>x.sampleId===sampleId)||null}
  async prepare(sampleId,{userId='LOCAL_USER'}={}){
    const sample=await repositories.samples.get(sampleId);if(!sample)throw new Error('Muestra no encontrada.');
    let entry=await this.entryBySample(sampleId);if(entry)return entry;
    const receptionDate=sample.receivedDate||isoDate();
    entry=await repositories.laboratory.create({
      id:stableId('LAB',sampleId),schemaVersion:1,sampleId,code:sample.code,year:sample.year,codeFull:sample.codeFull,
      clientId:sample.clientId,branch:sample.branch,matrixId:sample.matrixId,groupId:sample.groupId,
      samplingDate:sample.samplingDate,decisionStatus:sample.workflow?.decisionStatus||'CONTINUAR',
      receptionDate,analyst:'',serviceType:'INTERNO',samplingMonth:monthName(sample.samplingDate),slaDays:8,
      maxReportDate:addDays(receptionDate,8),labStatus:'PENDIENTE_INGRESO',officialEntryAt:'',officialEntryBy:'',
      history:[{action:'LAB_ENTRY_PREPARED',at:new Date().toISOString(),userId,detail:'Borrador de ingreso creado desde Registro de Muestras'}]
    },{userId});
    return entry;
  }
  async officialEntry(sampleId,input,{userId='LOCAL_USER'}={}){
    const sample=await repositories.samples.get(sampleId);if(!sample)throw new Error('Muestra no encontrada.');
    let entry=await this.entryBySample(sampleId);if(entry?.officialEntryAt)throw new Error('Esta muestra ya fue ingresada oficialmente al Laboratorio.');
    if(!entry)entry=await this.prepare(sampleId,{userId});
    const receptionDate=clean(input.receptionDate)||sample.receivedDate||isoDate();
    const analyst=clean(input.analyst);if(!analyst)throw new Error('Seleccione o escriba el analista.');
    const serviceType=upper(input.serviceType||'INTERNO');if(!['INTERNO','EXTERNO'].includes(serviceType))throw new Error('El tipo de servicio debe ser INTERNO o EXTERNO.');
    const slaDays=serviceType==='EXTERNO'?15:8;
    const maxReportDate=addDays(receptionDate,slaDays);
    await this.ensureAnalyst(analyst,{userId});
    const after=await repositories.laboratory.update(entry.id,{
      receptionDate,analyst,serviceType,samplingMonth:upper(input.samplingMonth||monthName(sample.samplingDate)),
      slaDays,maxReportDate,labStatus:'EN_PROCESO',officialEntryAt:new Date().toISOString(),officialEntryBy:userId,
      history:labHistory(entry,'LAB_OFFICIAL_ENTRY',userId,`Ingreso oficial · Analista: ${analyst} · SLA: ${slaDays} día(s)`)
    },{userId});
    eventBus.emit('laboratory.official-entry.completed',{sampleId,entryId:after.id,codeFull:sample.codeFull});
    return after;
  }
  async updateDraft(sampleId,input,{userId='LOCAL_USER'}={}){
    let entry=await this.entryBySample(sampleId);if(!entry)entry=await this.prepare(sampleId,{userId});
    if(entry.officialEntryAt)throw new Error('El ingreso ya es oficial. En Workspace solo se permite actualizar el analista.');
    const receptionDate=clean(input.receptionDate)||entry.receptionDate||isoDate();const serviceType=upper(input.serviceType||'INTERNO');const slaDays=serviceType==='EXTERNO'?15:8;
    await this.ensureAnalyst(input.analyst,{userId});
    return repositories.laboratory.update(entry.id,{receptionDate,analyst:clean(input.analyst),serviceType,samplingMonth:upper(input.samplingMonth),slaDays,maxReportDate:addDays(receptionDate,slaDays),history:labHistory(entry,'LAB_DRAFT_UPDATED',userId,'Datos previos al ingreso oficial actualizados')},{userId});
  }
  async saveAnalyst(entryId,analyst,{userId='LOCAL_USER'}={}){
    const entry=await repositories.laboratory.get(entryId);if(!entry)throw new Error('Ingreso de laboratorio no encontrado.');if(!entry.officialEntryAt)throw new Error('La muestra todavía no tiene ingreso oficial.');
    const value=clean(analyst);if(!value)throw new Error('El analista no puede quedar vacío.');
    await this.ensureAnalyst(value,{userId});
    return repositories.laboratory.update(entryId,{analyst:value,history:labHistory(entry,'LAB_ANALYST_UPDATED',userId,`Analista actualizado: ${value}`)},{userId});
  }
  async analysts(){
    return (await repositories.catalogs.all()).filter(x=>x.catalogType==='LAB_ANALYST'&&x.active!==false&&!x.deleted).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'es'));
  }
  async ensureAnalyst(name,{userId='LOCAL_USER'}={}){
    const value=clean(name);if(!value)return null;
    const all=await repositories.catalogs.all();
    const found=all.find(x=>x.catalogType==='LAB_ANALYST'&&upper(x.name)===upper(value)&&!x.deleted);
    if(found)return found;
    return repositories.catalogs.create({catalogType:'LAB_ANALYST',name:value,label:value,active:true},{userId});
  }

  async bulkOfficialEntryMigration({userId='MIGRATION_BULK'}={}){
    const [samples,entries]=await Promise.all([this.samples(),this.entries()]);
    const bySample=new Map(entries.map(x=>[x.sampleId,x]));
    const eligible=samples.filter(x=>x.workflow?.workflowStage==='SAMPLE_REGISTRY' && x.workflow?.recordStatus==='INGRESADA' && !bySample.get(x.id)?.officialEntryAt);
    if(!eligible.length)return {processed:0,created:0,updated:0,skipped:0};
    await this.ensureAnalyst('---',{userId});
    let created=0,updated=0,skipped=0,processed=0;
    for(const sample of eligible){
      try{
        let entry=bySample.get(sample.id)||null;
        const receptionDate=clean(sample.receivedDate)||clean(sample.samplingDate)||entry?.receptionDate||isoDate();
        const serviceType=['INTERNO','EXTERNO'].includes(upper(entry?.serviceType))?upper(entry.serviceType):'INTERNO';
        const slaDays=serviceType==='EXTERNO'?15:8;
        const payload={
          schemaVersion:1,sampleId:sample.id,code:sample.code,year:sample.year,codeFull:sample.codeFull,
          clientId:sample.clientId,branch:sample.branch,matrixId:sample.matrixId,groupId:sample.groupId,
          samplingDate:sample.samplingDate,decisionStatus:sample.workflow?.decisionStatus||'CONTINUAR',
          receptionDate,analyst:'---',serviceType,
          samplingMonth:upper(entry?.samplingMonth||monthName(sample.samplingDate)),slaDays,
          maxReportDate:addDays(receptionDate,slaDays),labStatus:'EN_PROCESO',
          officialEntryAt:new Date().toISOString(),officialEntryBy:userId
        };
        if(entry){
          const history=labHistory(entry,'LAB_BULK_MIGRATION_ENTRY',userId,`Ingreso masivo de migración · Analista: --- · Fecha recepción conservada: ${receptionDate}`);
          entry=await repositories.laboratory.update(entry.id,{...payload,history},{userId});updated++;
        }else{
          entry=await repositories.laboratory.create({id:stableId('LAB',sample.id),...payload,history:[{action:'LAB_BULK_MIGRATION_ENTRY',at:new Date().toISOString(),userId,detail:`Ingreso masivo de migración · Analista: --- · Fecha recepción conservada: ${receptionDate}`}]},{userId});created++;
          bySample.set(sample.id,entry);
        }
        processed++;
        eventBus.emit('laboratory.official-entry.completed',{sampleId:sample.id,entryId:entry.id,codeFull:sample.codeFull,bulk:true});
        if(processed%50===0)await new Promise(r=>setTimeout(r,0));
      }catch(err){console.error('Bulk intake failed',sample?.codeFull||sample?.id,err);skipped++}
    }
    return {processed,created,updated,skipped,totalEligible:eligible.length};
  }

  async reconcileDuplicateEntries({userId='SYSTEM_IDENTITY_REPAIR'}={}){
    if(this._reconcilePromise)return this._reconcilePromise;
    this._reconcilePromise=(async()=>{
      const rows=await repositories.laboratory.all();
      const groups=new Map();
      for(const r of rows){if(!r.sampleId)continue;const a=groups.get(r.sampleId)||[];a.push(r);groups.set(r.sampleId,a)}
      let fixed=0;
      for(const [,list] of groups){
        if(list.length<2)continue;
        // Conservar el ingreso más avanzado; en empate, el más antiguo y luego ID estable.
        list.sort((a,b)=>{
          const sa=(a.officialEntryAt?100:0)+(a.labStatus==='EN_PROCESO'?20:0)+Number(a.revision||0);
          const sb=(b.officialEntryAt?100:0)+(b.labStatus==='EN_PROCESO'?20:0)+Number(b.revision||0);
          if(sb!==sa)return sb-sa;
          const ca=String(a.createdAt||''),cb=String(b.createdAt||'');if(ca!==cb)return ca.localeCompare(cb);
          return String(a.id).localeCompare(String(b.id));
        });
        const keep=list[0];
        for(const dup of list.slice(1)){
          // Solo elimina una copia realmente redundante del mismo sampleId.
          await repositories.laboratory.softDelete(dup.id,{userId,sync:true});fixed++;
        }
      }
      return {fixed};
    })();
    try{return await this._reconcilePromise}finally{this._reconcilePromise=null}
  }
  async auditForSample(sampleId){
    const entry=await this.entryBySample(sampleId);return entry?.history||[];
  }
}
export const laboratoryService=new LaboratoryService();
