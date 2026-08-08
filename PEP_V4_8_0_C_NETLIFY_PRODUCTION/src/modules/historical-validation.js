import {getAll} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {getDeviceId} from '../core/device.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const up=v=>String(v??'').trim().toUpperCase();
const download=(name,text,type='application/json')=>{const b=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)};

async function collect(){
  const [samples,laboratory,reports,billing,receivables,clients,catalogs,audit,outbox,inbox,users,roles,meta]=await Promise.all([
    getAll(STORES.samples),getAll(STORES.laboratory),getAll(STORES.reports),getAll(STORES.billing),getAll(STORES.receivables),getAll(STORES.clients),getAll(STORES.catalogs),getAll(STORES.audit),getAll(STORES.outbox),getAll(STORES.inbox),getAll(STORES.users),getAll(STORES.roles),getAll(STORES.meta)
  ]);
  return {samples,laboratory,reports,billing,receivables,clients,catalogs,audit,outbox,inbox,users,roles,meta};
}
function validateSamples(samples,catalogs,expectedTotal){
  const active=samples.filter(x=>!x.deleted),matrixMap=new Map(catalogs.filter(x=>x.catalogType==='MATRIX'&&!x.deleted).map(x=>[up(x.name),x]));
  const duplicateMap=new Map(),issues=[];
  const groups={AGUA:0,SUELOS:0,OTRO:0},decisions={CONTINUAR:0,DETENIDA:0,OTRO:0},years={},matrices={},clients=new Set();
  for(const s of active){
    const key=`${up(s.code)}-${s.year}|${up(s.groupId)}`;duplicateMap.set(key,(duplicateMap.get(key)||0)+1);
    if(!s.code)issues.push({id:s.id,code:'',issue:'Código vacío'});
    if(!Number.isInteger(Number(s.year))||Number(s.year)<2000||Number(s.year)>2100)issues.push({id:s.id,code:s.code,issue:'Año inválido'});
    if(!s.clientId)issues.push({id:s.id,code:s.code,issue:'Cliente vacío'});
    if(!s.branch)issues.push({id:s.id,code:s.code,issue:'Sucursal vacía'});
    if(!s.samplingDate)issues.push({id:s.id,code:s.code,issue:'Fecha de muestra vacía'});
    const m=matrixMap.get(up(s.matrixId));if(!m)issues.push({id:s.id,code:s.code,issue:`Matriz no catalogada: ${s.matrixId||'vacía'}`});
    else if(up(m.groupId)!==up(s.groupId))issues.push({id:s.id,code:s.code,issue:`Grupo ${s.groupId} no coincide con matriz ${s.matrixId} (${m.groupId})`});
    const g=up(s.groupId);groups[g in groups?g:'OTRO']++;
    const d=up(s.workflow?.decisionStatus);decisions[d in decisions?d:'OTRO']++;
    years[String(s.year||'SIN AÑO')]=(years[String(s.year||'SIN AÑO')]||0)+1;
    matrices[up(s.matrixId)||'SIN MATRIZ']=(matrices[up(s.matrixId)||'SIN MATRIZ']||0)+1;
    if(s.clientId)clients.add(up(s.clientId));
  }
  const duplicates=[...duplicateMap.entries()].filter(([,n])=>n>1).map(([key,count])=>({key,count}));
  return {expectedTotal:Number(expectedTotal||0),total:active.length,totalMatches:!Number(expectedTotal)||active.length===Number(expectedTotal),duplicates,issues,groups,decisions,years,matrices,clients:clients.size};
}
function render(v,stores){
  const ok=v.totalMatches&&!v.duplicates.length&&!v.issues.length;
  const topMatrices=Object.entries(v.matrices).sort((a,b)=>b[1]-a[1]).slice(0,12);
  return `<div class="import-kpis" style="margin-bottom:12px"><div class="import-kpi"><b>${v.total}</b><span>Total muestras</span></div><div class="import-kpi"><b>${v.expectedTotal||'—'}</b><span>Total esperado</span></div><div class="import-kpi"><b>${v.duplicates.length}</b><span>Duplicados reales</span></div><div class="import-kpi"><b>${v.issues.length}</b><span>Incidencias</span></div></div>
  <div class="notice" style="border-color:${ok?'#9bd7b0':'#e9c46a'}"><b>Resultado:</b> ${ok?'✅ BASE LOCAL VALIDADA':'⚠️ REVISAR ANTES DEL RESPALDO MAESTRO'} · Conteo ${v.totalMatches?'correcto':'diferente al esperado'} · ${v.clients} cliente(s) · AGUA ${v.groups.AGUA} · SUELOS ${v.groups.SUELOS}.</div>
  <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Store</th><th>Registros</th><th>Store</th><th>Registros</th></tr></thead><tbody><tr><td>samples</td><td>${stores.samples.length}</td><td>laboratory</td><td>${stores.laboratory.length}</td></tr><tr><td>reports</td><td>${stores.reports.length}</td><td>billing</td><td>${stores.billing.length}</td></tr><tr><td>receivables</td><td>${stores.receivables.length}</td><td>clients</td><td>${stores.clients.length}</td></tr><tr><td>audit</td><td>${stores.audit.length}</td><td>outbox</td><td>${stores.outbox.length}</td></tr></tbody></table></div>
  <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Matriz</th><th>Muestras</th></tr></thead><tbody>${topMatrices.map(([m,n])=>`<tr><td>${esc(m)}</td><td>${n}</td></tr>`).join('')}</tbody></table></div>
  ${v.duplicates.length?`<div class="import-errors" style="margin-top:12px"><b>Duplicados Código + Año + Grupo (${v.duplicates.length})</b><br>${v.duplicates.slice(0,100).map(x=>`${esc(x.key)} · ${x.count} registros`).join('<br>')}</div>`:''}
  ${v.issues.length?`<div class="import-errors" style="margin-top:12px"><b>Incidencias (${v.issues.length})</b><br>${v.issues.slice(0,150).map(x=>`${esc(x.code||x.id)}: ${esc(x.issue)}`).join('<br>')}</div>`:''}`;
}
export const historicalValidation={
  last:null,
  async run(expectedTotal=2100){const stores=await collect(),validation=validateSamples(stores.samples,stores.catalogs,expectedTotal);this.last={validation,stores,validatedAt:new Date().toISOString()};return this.last},
  render(container,result){container.innerHTML=render(result.validation,result.stores)},
  async downloadMaster(expectedTotal=2100){
    const result=this.last||await this.run(expectedTotal);const {stores,validation}=result;
    const safeMeta=stores.meta.filter(x=>x.id!=='financial_module_access');
    const payload={format:'PEP_MASTER_LOCAL_BACKUP_V1',version:'PEP V3.8.0',exportedAt:new Date().toISOString(),deviceId:getDeviceId(),validation,stores:{samples:stores.samples,laboratory:stores.laboratory,reports:stores.reports,billing:stores.billing,receivables:stores.receivables,clients:stores.clients,catalogs:stores.catalogs,users:stores.users,roles:stores.roles,auditLog:stores.audit,outbox:stores.outbox,inbox:stores.inbox,meta:safeMeta}};
    const date=new Date().toISOString().slice(0,10);download(`PEP_V3_8_0_RESPALDO_MAESTRO_LOCAL_${date}_${stores.samples.filter(x=>!x.deleted).length}_MUESTRAS.json`,JSON.stringify(payload,null,2));return validation;
  }
};
