import {repositories} from '../data/repositories.js';
import {auditRepository} from '../data/audit-repository.js';
import {eventBus} from '../core/event-bus.js';
import {uuid} from '../core/uuid.js';

const clean=v=>String(v??'').trim();
const upper=v=>clean(v).toUpperCase().replace(/\s+/g,' ');
const now=()=>new Date().toISOString();
const DEFAULT_MATRICES=[
  {name:'CONSUMO',label:'CONSUMO',groupId:'AGUA',codeFamily:'AGUA'},
  {name:'RESIDUAL',label:'RESIDUAL',groupId:'AGUA',codeFamily:'AGUA'},
  {name:'NATURAL',label:'NATURAL',groupId:'AGUA',codeFamily:'AGUA'},
  {name:'SUELO',label:'SUELO',groupId:'SUELOS',codeFamily:'SUELO'},
  {name:'LODO',label:'LODO',groupId:'SUELOS',codeFamily:'SUELO'},
  {name:'LODOS CRETIB',label:'LODOS CRETIB',groupId:'SUELOS',codeFamily:'SUELO'}
];

function workflowBase(){return {recordStatus:'DRAFT',decisionStatus:'UNDECIDED',analysisStatus:'NOT_EVALUATED',workflowStage:'UNASSIGNED',requirements:{dqo:false,surfactants:false},analysisValues:{dqo:'',surfactants:''},waitingDecision:null,history:[],closedAt:null,updatedAt:null,updatedBy:null}}
function historyEntry(action,from,to,userId,applied={}){return {id:uuid(),at:now(),userId,action,from,to,applied}}
function initialWorkflow({requiresDqo,requiresSurfactants,userId}){
  const required=Boolean(requiresDqo||requiresSurfactants); const base=workflowBase();
  const patch=required?{recordStatus:'PLANIFICADA',decisionStatus:'PENDING_ANALYSIS',analysisStatus:'REQUIRED',workflowStage:'ANALYSIS_REGISTRATION',requirements:{dqo:!!requiresDqo,surfactants:!!requiresSurfactants}}:{recordStatus:'INGRESADA',decisionStatus:'CONTINUAR',analysisStatus:'NOT_REQUIRED',workflowStage:'SAMPLE_REGISTRY',requirements:{dqo:false,surfactants:false}};
  const action=required?'INITIAL_ANALYSIS_REQUIRED':'INITIAL_NO_ANALYSIS'; const at=now();
  return {...base,...patch,history:[historyEntry(action,'UNASSIGNED',patch.workflowStage,userId,patch)],updatedAt:at,updatedBy:userId,closedAt:required?null:at};
}
async function transition(id,patch,action,{userId='LOCAL_USER'}={}){
  const current=await repositories.samples.get(id); if(!current||current.deleted)throw new Error('La muestra no existe.');
  const previous=current.workflow||workflowBase(); const from=previous.workflowStage||'UNASSIGNED'; const to=patch.workflowStage||from;
  if(previous.closedAt&&previous.workflowStage==='SAMPLE_REGISTRY')throw new Error('El flujo ya fue cerrado y no puede reingresar a Registro de Análisis.');
  const entry=historyEntry(action,from,to,userId,patch); const closes=to==='SAMPLE_REGISTRY'&&patch.recordStatus==='INGRESADA';
  const workflow={...previous,...patch,history:[...(previous.history||[]),entry],updatedAt:entry.at,updatedBy:userId,closedAt:closes?(previous.closedAt||entry.at):null};
  const saved=await repositories.samples.update(id,{workflow,status:patch.recordStatus||current.status},{userId});
  eventBus.emit('workflow.transition',{id,action,from,to,at:entry.at}); return saved;
}

async function upsertClient(name,branch,userId){
  const normalized=upper(name), branchName=upper(branch); if(!normalized)throw new Error('El cliente es obligatorio.');
  const all=await repositories.clients.all(); let client=all.find(x=>upper(x.name)===normalized);
  if(!client)return repositories.clients.create({name:normalized,identification:'',branches:branchName?[branchName]:[]},{userId});
  const branches=[...(client.branches||[])]; if(branchName&&!branches.some(x=>upper(x)===branchName))branches.push(branchName);
  if(branches.length!==(client.branches||[]).length)client=await repositories.clients.update(client.id,{branches},{userId});
  return client;
}

export class SampleRegistryService{
  async ensureCatalogs(){
    const rows=await repositories.catalogs.all();
    const matrices=rows.filter(x=>x.catalogType==='MATRIX');
    if(!matrices.length){for(const m of DEFAULT_MATRICES)await repositories.catalogs.create({catalogType:'MATRIX',...m,active:true},{userId:'SYSTEM_SEED',sync:false})}
  }
  async matrices(){return (await repositories.catalogs.all()).filter(x=>x.catalogType==='MATRIX'&&x.active!==false).sort((a,b)=>String(a.label||a.name).localeCompare(String(b.label||b.name),'es'))}
  async matrixById(id){const rows=await this.matrices();const m=rows.find(x=>x.id===id)||rows.find(x=>upper(x.name)===upper(id));if(!m)throw new Error('Seleccione una matriz válida.');return m}
  async clients(){return (await repositories.clients.all()).sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'))}
  async saveClientCatalog(input,{userId='LOCAL_USER'}={}){
    const name=upper(input.name); if(!name)throw new Error('El nombre del cliente es obligatorio.');
    const branches=[...new Set((input.branches||[]).map(upper).filter(Boolean))]; const all=await repositories.clients.all();
    const duplicate=all.find(x=>upper(x.name)===name&&x.id!==input.id); if(duplicate)throw new Error('Ya existe un cliente con ese nombre.');
    if(!input.id)return repositories.clients.create({name,identification:clean(input.identification),branches},{userId});
    const before=await repositories.clients.get(input.id); if(!before)throw new Error('Cliente no encontrado.');
    const saved=await repositories.clients.update(input.id,{name,identification:clean(input.identification),branches},{userId});
    if(upper(before.name)!==name){const samples=await repositories.samples.all();for(const s of samples.filter(x=>x.clientCatalogId===input.id))await repositories.samples.update(s.id,{clientId:name},{userId})}
    return saved;
  }
  async deleteClientCatalog(id,{userId='LOCAL_USER'}={}){const used=(await repositories.samples.all()).some(x=>x.clientCatalogId===id);if(used)throw new Error('Este cliente ya está usado en muestras y no puede eliminarse. Puede editarlo.');return repositories.clients.softDelete(id,{userId})}
  async saveMatrixCatalog(input,{userId='LOCAL_USER'}={}){
    const name=upper(input.name),groupId=upper(input.groupId);if(!name)throw new Error('El nombre de la matriz es obligatorio.');if(!['AGUA','SUELOS'].includes(groupId))throw new Error('El grupo debe ser AGUA o SUELOS.');
    const all=await repositories.catalogs.all();const matrices=all.filter(x=>x.catalogType==='MATRIX'&&!x.deleted);const duplicate=matrices.find(x=>upper(x.name)===name&&x.id!==input.id);if(duplicate)throw new Error('Ya existe una matriz con ese nombre.');
    const data={catalogType:'MATRIX',name,label:upper(input.label||name),groupId,codeFamily:groupId==='AGUA'?'AGUA':'SUELO',active:true};
    if(!input.id)return repositories.catalogs.create(data,{userId});
    const before=await repositories.catalogs.get(input.id);if(!before)throw new Error('Matriz no encontrada.');
    const used=(await repositories.samples.all()).some(x=>x.matrixCatalogId===input.id||(!x.matrixCatalogId&&upper(x.matrixId)===upper(before.name)));
    if(used&&(upper(before.name)!==name||upper(before.groupId)!==groupId))throw new Error('Esta matriz ya está usada. Para proteger registros históricos no se puede cambiar su nombre ni grupo; sí puede cambiar la etiqueta.');
    return repositories.catalogs.update(input.id,data,{userId});
  }
  async deleteMatrixCatalog(id,{userId='LOCAL_USER'}={}){const m=await repositories.catalogs.get(id);if(!m)throw new Error('Matriz no encontrada.');const used=(await repositories.samples.all()).some(x=>x.matrixCatalogId===id||(!x.matrixCatalogId&&upper(x.matrixId)===upper(m.name)));if(used)throw new Error('Esta matriz ya está usada y no puede eliminarse.');return repositories.catalogs.softDelete(id,{userId})}
  async register(input,{userId='LOCAL_USER'}={}){
    const code=upper(input.code),year=Number(input.year),clientName=upper(input.client),branch=upper(input.branch),matrix=await this.matrixById(input.matrixCatalogId||input.matrixId);
    if(!code)throw new Error('El código es obligatorio.');if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('El año debe estar entre 2000 y 2100.');if(!clientName)throw new Error('El cliente es obligatorio.');if(!clean(input.samplingDate))throw new Error('La fecha de muestra es obligatoria.');
    const codeFull=`${code}-${year}`;const existing=await repositories.samples.all();if(existing.some(x=>upper(x.codeFull)===codeFull&&x.groupId===matrix.groupId))throw new Error(`Ya existe la muestra ${codeFull} en el grupo ${matrix.groupId}.`);
    const client=await upsertClient(clientName,branch,userId);const workflow=initialWorkflow({requiresDqo:!!input.requiresDqo,requiresSurfactants:!!input.requiresSurfactants,userId});
    const sample=await repositories.samples.create({schemaVersion:2,code,year,codeFull,clientId:client.name,clientCatalogId:client.id,branch,matrixId:matrix.name,matrixCatalogId:matrix.id,groupId:matrix.groupId,codeFamily:matrix.codeFamily,samplingDate:clean(input.samplingDate),receivedDate:clean(input.receivedDate),monthFrequency:clean(input.monthFrequency),status:workflow.recordStatus,observations:clean(input.observations),workflow,metadata:{source:'SAMPLE_REGISTRY_V3_1_0'}},{userId});
    eventBus.emit('sample.registration.completed',{id:sample.id,codeFull:sample.codeFull,workflow:sample.workflow});return sample;
  }
  async updateRegistry(id,input,{userId='LOCAL_USER'}={}){
    const current=await repositories.samples.get(id);if(!current)throw new Error('Muestra no encontrada.');const matrix=await this.matrixById(input.matrixCatalogId||input.matrixId);const code=upper(input.code),year=Number(input.year);if(!code)throw new Error('El código es obligatorio.');if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('El año debe estar entre 2000 y 2100.');if(!clean(input.samplingDate))throw new Error('La fecha de muestra es obligatoria.');
    const codeFull=`${code}-${year}`;const all=await repositories.samples.all();if(all.some(x=>x.id!==id&&upper(x.codeFull)===codeFull&&x.groupId===matrix.groupId))throw new Error(`Ya existe la muestra ${codeFull} en el grupo ${matrix.groupId}.`);
    const client=await upsertClient(input.client,input.branch,userId);return repositories.samples.update(id,{code,year,codeFull,clientId:client.name,clientCatalogId:client.id,branch:upper(input.branch),matrixId:matrix.name,matrixCatalogId:matrix.id,groupId:matrix.groupId,codeFamily:matrix.codeFamily,samplingDate:clean(input.samplingDate),receivedDate:clean(input.receivedDate),monthFrequency:clean(input.monthFrequency),observations:clean(input.observations)},{userId});
  }
  async registerAnalysis(id,values,{userId='LOCAL_USER'}={}){const s=await repositories.samples.get(id);if(s?.workflow?.workflowStage!=='ANALYSIS_REGISTRATION')throw new Error('La muestra no está en Registro de Análisis.');const req=s.workflow.requirements||{};if(req.dqo&&!clean(values.dqo))throw new Error('El valor DQO es obligatorio.');if(req.surfactants&&!clean(values.surfactants))throw new Error('El valor de tensoactivos es obligatorio.');return transition(id,{recordStatus:'INGRESADA',decisionStatus:'CONTINUAR',analysisStatus:'COMPLETED',workflowStage:'SAMPLE_REGISTRY',analysisValues:{dqo:clean(values.dqo),surfactants:clean(values.surfactants),registeredAt:now(),registeredBy:userId}},'ANALYSIS_REGISTERED_CONTINUE',{userId})}
  async sendToWaiting(id,values,{userId='LOCAL_USER'}={}){const s=await repositories.samples.get(id);if(s?.workflow?.workflowStage!=='ANALYSIS_REGISTRATION')throw new Error('La muestra no está en Registro de Análisis.');return transition(id,{recordStatus:'PLANIFICADA',decisionStatus:'PENDIENTE',analysisStatus:'WAITING_DECISION',workflowStage:'WAITING',analysisValues:{dqo:clean(values.dqo),surfactants:clean(values.surfactants),registeredAt:now(),registeredBy:userId}},'ANALYSIS_SENT_TO_WAITING',{userId})}
  async continueWaiting(id,reason,{userId='LOCAL_USER'}={}){return transition(id,{recordStatus:'INGRESADA',decisionStatus:'CONTINUAR',analysisStatus:'CLOSED',workflowStage:'SAMPLE_REGISTRY',waitingDecision:{decision:'CONTINUAR',reason:clean(reason),decidedAt:now(),decidedBy:userId}},'WAITING_CONTINUE',{userId})}
  async stopWaiting(id,reason,{userId='LOCAL_USER'}={}){return transition(id,{recordStatus:'INGRESADA',decisionStatus:'DETENIDA',analysisStatus:'CLOSED',workflowStage:'SAMPLE_REGISTRY',waitingDecision:{decision:'DETENIDA',reason:clean(reason),decidedAt:now(),decidedBy:userId}},'WAITING_STOPPED',{userId})}

  async importHistorical(rows,{userId='EXCEL_IMPORT',updateDuplicates=false}={}){
    const results={created:0,updated:0,skipped:0,errors:[]};
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      try{
        const code=upper(r.code),year=Number(r.year),clientName=upper(r.client),branch=upper(r.branch),matrix=await this.matrixById(r.matrixCatalogId||r.matrixId);
        if(!code)throw new Error('CODIGO vacío');
        if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('ANIO inválido');
        if(!clientName)throw new Error('CLIENTE vacío');
        if(!clean(r.samplingDate))throw new Error('FECHA vacía');
        const codeFull=`${code}-${year}`;
        const all=await repositories.samples.all();
        const existing=all.find(x=>upper(x.codeFull)===codeFull&&x.groupId===matrix.groupId);
        const client=await upsertClient(clientName,branch,userId);
        const dqo=clean(r.dqo),surfactants=clean(r.surfactants);
        const requiresSpecial=!!(dqo||surfactants||r.requiresSpecialAnalysis);
        const decision=upper(r.decision)==='DETENIDA'?'DETENIDA':'CONTINUAR';
        const at=now();
        const workflow={requirements:{dqo:requiresSpecial,surfactants:requiresSpecial},recordStatus:'INGRESADA',decisionStatus:decision,analysisStatus:requiresSpecial?'COMPLETED':'NOT_REQUIRED',workflowStage:'SAMPLE_REGISTRY',analysisValues:{dqo,surfactants,registeredAt:requiresSpecial?at:'',registeredBy:requiresSpecial?userId:''},waitingDecision:decision==='DETENIDA'?{decision:'DETENIDA',reason:'Importado desde Excel',decidedAt:at,decidedBy:userId}:null,history:[{action:'EXCEL_HISTORICAL_IMPORT',from:'EXCEL',to:'SAMPLE_REGISTRY',at,userId}]};
        const data={schemaVersion:2,code,year,codeFull,clientId:client.name,clientCatalogId:client.id,branch,matrixId:matrix.name,matrixCatalogId:matrix.id,groupId:matrix.groupId,codeFamily:matrix.codeFamily,samplingDate:clean(r.samplingDate),receivedDate:clean(r.receivedDate||r.samplingDate),monthFrequency:clean(r.monthFrequency),status:'INGRESADA',observations:clean(r.observations),workflow,metadata:{source:'EXCEL_IMPORT_V3_1_0',analyst:clean(r.analyst),serviceType:clean(r.serviceType||'INTERNO'),sampleIdSource:clean(r.sampleId)}};
        if(existing){
          if(!updateDuplicates){results.skipped++;continue}
          await repositories.samples.update(existing.id,data,{userId});results.updated++;
        }else{await repositories.samples.create(data,{userId});results.created++}
      }catch(e){results.errors.push({row:i+2,message:e.message||String(e),code:r?.code||''})}
    }
    eventBus.emit('samples.excel.import.completed',results);
    return results;
  }
  async all(){return repositories.samples.all()}
  async queues(){const rows=await this.all();return {analysis:rows.filter(x=>x.workflow?.workflowStage==='ANALYSIS_REGISTRATION'),waiting:rows.filter(x=>x.workflow?.workflowStage==='WAITING'),stopped:rows.filter(x=>x.workflow?.decisionStatus==='DETENIDA'),registry:rows.filter(x=>x.workflow?.workflowStage==='SAMPLE_REGISTRY'&&x.workflow?.recordStatus==='INGRESADA')}}
  async auditFor(id){return (await auditRepository.all()).filter(x=>x.entityId===id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
}
export const sampleRegistryService=new SampleRegistryService();
