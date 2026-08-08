import {get,put} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {repositories} from '../data/repositories.js';

const MANIFEST_ID='last_import_manifest_v382';
const clean=v=>String(v??'').trim();
const up=v=>clean(v).toUpperCase().replace(/\s+/g,' ');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const keyOf=r=>`${up(r.code)}-${Number(r.year)||0}|${up(r.groupId||r.derivedGroup)}`;

function normalizeSourceRow(r){
  return {
    sourceRow:Number(r.sourceRow||0),code:clean(r.code),year:Number(r.year||0),client:clean(r.client),branch:clean(r.branch),
    matrixId:clean(r.matrixId),matrixCatalogId:clean(r.matrixCatalogId),groupId:up(r.groupId||r.derivedGroup),samplingDate:clean(r.samplingDate),
    receivedDate:clean(r.receivedDate),monthFrequency:clean(r.monthFrequency),dqo:clean(r.dqo),surfactants:clean(r.surfactants),decision:up(r.decision||'CONTINUAR'),
    state:up(r.state||'INGRESADA'),observations:clean(r.observations),analyst:clean(r.analyst),serviceType:clean(r.serviceType||'INTERNO'),sampleId:clean(r.sampleId),
    requiresSpecialAnalysis:!!(r.dqo||r.surfactants||r.requiresSpecialAnalysis)
  };
}

async function saveManifest(rows,{fileName='',format=''}={}){
  const normalized=(rows||[]).map(normalizeSourceRow).filter(r=>r.code&&r.year&&r.groupId);
  const manifest={id:MANIFEST_ID,version:'PEP_V3_8_2_IMPORT_MANIFEST',fileName,format,expected:normalized.length,savedAt:new Date().toISOString(),rows:normalized};
  await put(STORES.meta,manifest);return manifest;
}
async function loadManifest(){return get(STORES.meta,MANIFEST_ID)}

function compareRows(sourceRows,localRows){
  const source=(sourceRows||[]).map(normalizeSourceRow).filter(r=>r.code&&r.year&&r.groupId);
  const local=(localRows||[]).filter(x=>!x.deleted);
  const localBuckets=new Map();
  for(const s of local){const k=`${up(s.code)}-${Number(s.year)||0}|${up(s.groupId)}`;if(!localBuckets.has(k))localBuckets.set(k,[]);localBuckets.get(k).push(s)}
  const used=new Map(),missing=[];
  for(const r of source){
    const k=keyOf(r),bucket=localBuckets.get(k)||[],n=used.get(k)||0;
    if(n<bucket.length)used.set(k,n+1);else missing.push({...r,key:k});
  }
  const sourceCounts=new Map();for(const r of source){const k=keyOf(r);sourceCounts.set(k,(sourceCounts.get(k)||0)+1)}
  const extras=[];
  for(const [k,bucket] of localBuckets){const expected=sourceCounts.get(k)||0;if(bucket.length>expected)extras.push(...bucket.slice(expected).map(s=>({key:k,id:s.id,code:s.code,year:s.year,groupId:s.groupId,client:s.clientId,branch:s.branch,matrixId:s.matrixId})))}
  return {sourceCount:source.length,localCount:local.length,missing,extras,ok:missing.length===0,verifiedAt:new Date().toISOString()};
}

function render(container,result,manifest){
  if(!container)return;
  if(!result){container.innerHTML='<div class="empty">Seleccione nuevamente el Excel histórico o importe un archivo para crear el manifiesto de verificación.</div>';return}
  const m=result.missing,e=result.extras;
  container.innerHTML=`
    <div class="import-kpis" style="margin-bottom:12px">
      <div class="import-kpi"><b>${result.sourceCount}</b><span>Filas del Excel</span></div>
      <div class="import-kpi"><b>${result.localCount}</b><span>Samples guardadas</span></div>
      <div class="import-kpi"><b>${m.length}</b><span>Faltantes</span></div>
      <div class="import-kpi"><b>${e.length}</b><span>Extras locales</span></div>
    </div>
    <div class="notice" style="border-color:${result.ok?'#9bd7b0':'#e9c46a'}"><b>Verificación:</b> ${result.ok?'✅ TODAS LAS FILAS DEL EXCEL EXISTEN EN samples':'⚠️ HAY FILAS DEL EXCEL QUE NO QUEDARON GUARDADAS'}${manifest?.fileName?` · Archivo: ${esc(manifest.fileName)}`:''}</div>
    ${m.length?`<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Fila Excel</th><th>Código</th><th>Año</th><th>Grupo</th><th>Cliente / Sucursal</th><th>Matriz</th><th>Fecha</th></tr></thead><tbody>${m.slice(0,100).map(x=>`<tr><td><b>${x.sourceRow||'—'}</b></td><td><b>${esc(x.code)}</b></td><td>${esc(x.year)}</td><td>${esc(x.groupId)}</td><td><b>${esc(x.client)}</b><div class="muted">${esc(x.branch||'—')}</div></td><td>${esc(x.matrixId)}</td><td>${esc(x.samplingDate)}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${m.length===1?'<div class="actions" style="margin-top:12px"><button class="btn primary" id="recoverSingleMissingImport" type="button">🩹 Recuperar registro faltante</button><span class="muted">Se insertará únicamente esta fila; no se volverán a importar las demás.</span></div>':''}
    ${e.length?`<details style="margin-top:12px"><summary><b>Ver ${e.length} registro(s) local(es) extra</b></summary><div class="import-errors" style="margin-top:8px">${e.slice(0,100).map(x=>`${esc(x.code)}-${esc(x.year)} · ${esc(x.groupId)} · ${esc(x.client||'')}`).join('<br>')}</div></details>`:''}`;
}

export const importVerification={
  last:null,
  saveManifest,
  loadManifest,
  normalizeSourceRow,
  async compare(rows=null,meta={}){
    let manifest;
    if(rows?.length)manifest=await saveManifest(rows,meta);else manifest=await loadManifest();
    if(!manifest?.rows?.length)throw new Error('No existe un manifiesto de importación. Seleccione el Excel histórico nuevamente.');
    const local=await repositories.samples.all({includeDeleted:true});
    const result=compareRows(manifest.rows,local);this.last={result,manifest};return this.last;
  },
  render,
  getSingleMissing(){return this.last?.result?.missing?.length===1?this.last.result.missing[0]:null}
};
