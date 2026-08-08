import {reportsService,AUTHORIZATION_LABELS,isAuthorizationHold} from './reports.js';
import {repositories} from '../data/repositories.js';
import {visibleForActiveSamples} from '../data/tombstone.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>{if(!v)return '—';const d=new Date(`${String(v).slice(0,10)}T12:00:00`);return Number.isNaN(d.getTime())?esc(v):d.toLocaleDateString('es-EC')};
const today=()=>new Date().toISOString().slice(0,10);
let rows=[];
const selectedPending=new Set();
const selectedAuth=new Set();
const selectedPortal=new Set();
let initialized=false;

function toast(msg,error=false){
  const el=$('toast');if(!el)return;
  el.textContent=msg;el.className=`toast show${error?' error':''}`;
  clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='toast',3000);
}
function searchMatch(r,q){return !q||[r.code,r.codeFull,r.clientId,r.branch,r.matrixId,r.groupId,r.analyst,r.serviceType].join(' ').toLowerCase().includes(q)}
function stageLabel(r){return ({PENDING_DELIVERY:'INFORME PENDIENTE',AUTHORIZATION:'AUTORIZACIÓN',PORTAL_PENDING:'PORTAL PENDIENTE',PORTAL_SENT:'PORTAL ENVIADO'})[r.reportStatus]||r.reportStatus||'—'}
function authLabel(v){return AUTHORIZATION_LABELS[String(v||'')]||'—'}
function daysUntil(v){if(!v)return null;const a=new Date(`${v}T12:00:00`),b=new Date();b.setHours(12,0,0,0);return Math.ceil((a-b)/86400000)}
function slaBadge(r){const n=daysUntil(r.maxReportDate);if(n===null)return '<span class="badge">—</span>';if(n<0)return `<span class="badge red">VENCIDO · ${Math.abs(n)} día(s)</span>`;return `<span class="badge green">EN PLAZO · ${n} día(s)</span>`}
function checked(set,id){return set.has(id)?'checked':''}
function authOptions(current=''){return `<option value="">Seleccione...</option>${Object.entries(AUTHORIZATION_LABELS).map(([k,v])=>`<option value="${k}" ${String(current)===k?'selected':''}>${esc(v)}</option>`).join('')}`}

function renderStats(){
  const pending=rows.filter(r=>r.reportStatus==='PENDING_DELIVERY').length;
  const auth=rows.filter(r=>r.reportStatus==='AUTHORIZATION').length;
  const portal=rows.filter(r=>r.reportStatus==='PORTAL_PENDING').length;
  const sent=rows.filter(r=>r.reportStatus==='PORTAL_SENT').length;
  const overdue=rows.filter(r=>r.reportStatus==='PENDING_DELIVERY'&&(daysUntil(r.maxReportDate)??0)<0).length;
  if($('reportsStats'))$('reportsStats').innerHTML=[['Pendientes',pending],['Autorización',auth],['Portal pendiente',portal],['Portal enviado',sent],['Vencidos',overdue]].map(([l,v])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  if($('countReports'))$('countReports').textContent=rows.length;
  if($('countReportsPending'))$('countReportsPending').textContent=pending;
  if($('countReportsAuth'))$('countReportsAuth').textContent=auth;
  if($('countReportsPortal'))$('countReportsPortal').textContent=portal;
  if($('countReportsFinal'))$('countReportsFinal').textContent=rows.length;
}
function renderPending(){
  const host=$('reportsPendingTable');if(!host)return;
  const q=($('searchReportsPending')?.value||'').trim().toLowerCase();
  const list=rows.filter(r=>r.reportStatus==='PENDING_DELIVERY'&&searchMatch(r,q));
  host.innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th></th><th>Código</th><th>Cliente / Sucursal</th><th>Matriz</th><th>Analista</th><th>Recepción</th><th>F. máxima</th><th>SLA</th><th>Entrega real</th><th>Acción</th></tr></thead><tbody>${list.map(r=>`<tr><td><input type="checkbox" style="width:auto" data-report-pending-check="${r.id}" ${checked(selectedPending,r.id)}></td><td><b>${esc(r.code)}</b><div class="muted">${esc(r.year)}</div></td><td><b>${esc(r.clientId)}</b><div class="muted">${esc(r.branch||'—')}</div></td><td>${esc(r.matrixId)}<div class="muted">${esc(r.groupId||'')}</div></td><td>${esc(r.analyst||'—')}</td><td>${fmt(r.receptionDate)}</td><td><b>${fmt(r.maxReportDate)}</b></td><td>${slaBadge(r)}</td><td><input type="date" id="reportDelivery_${r.id}" value="${esc(r.realDeliveryDate||'')}"></td><td><button class="btn primary small" data-report-delivery-save="${r.id}">Guardar</button> <button class="btn danger small" data-safe-delete-sample="${r.sampleId}" data-safe-delete-stage="REPORTS_PENDING">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay informes pendientes de entrega real.</div>';
  if($('reportsPendingVisible'))$('reportsPendingVisible').textContent=`${list.length} visibles`;
  if($('reportsPendingSelected'))$('reportsPendingSelected').textContent=`${selectedPending.size} seleccionados`;
}
function renderAuthorization(){
  const host=$('reportsAuthTable');if(!host)return;
  const q=($('searchReportsAuth')?.value||'').trim().toLowerCase();
  const list=rows.filter(r=>r.reportStatus==='AUTHORIZATION'&&searchMatch(r,q));
  host.innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th></th><th>Código</th><th>Cliente / Sucursal</th><th>Analista</th><th>Entrega real</th><th>Estado autorización</th><th>Fecha autorización</th><th>Acción</th></tr></thead><tbody>${list.map(r=>{const hold=isAuthorizationHold(r.authorizationStatus);return `<tr><td><input type="checkbox" style="width:auto" data-report-auth-check="${r.id}" ${checked(selectedAuth,r.id)}></td><td><b>${esc(r.code)}</b><div class="muted">${esc(r.year)}</div></td><td><b>${esc(r.clientId)}</b><div class="muted">${esc(r.branch||'—')}</div></td><td>${esc(r.analyst||'—')}</td><td>${fmt(r.realDeliveryDate)}</td><td><select id="reportAuthStatus_${r.id}" data-report-auth-status="${r.id}">${authOptions(r.authorizationStatus)}</select></td><td><input type="date" id="reportAuthDate_${r.id}" value="${hold?'':esc(r.authorizationDate||today())}" ${hold?'disabled':''}></td><td><button class="btn ${hold?'secondary':'primary'} small" id="reportAuthBtn_${r.id}" data-report-auth-save="${r.id}">${hold?'Guardar estado':'Autorizar'}</button> <button class="btn danger small" data-safe-delete-sample="${r.sampleId}" data-safe-delete-stage="AUTHORIZATION">Eliminar</button></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No hay informes pendientes de autorización.</div>';
  if($('reportsAuthSelected'))$('reportsAuthSelected').textContent=`${selectedAuth.size} seleccionados`;
}
function renderPortal(){
  const host=$('reportsPortalTable');if(!host)return;
  const q=($('searchReportsPortal')?.value||'').trim().toLowerCase();
  const list=rows.filter(r=>r.reportStatus==='PORTAL_PENDING'&&searchMatch(r,q));
  host.innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th></th><th>Código</th><th>Cliente / Sucursal</th><th>Matriz</th><th>Autorización</th><th>Fecha autorización</th><th>Portal</th></tr></thead><tbody>${list.map(r=>`<tr><td><input type="checkbox" style="width:auto" data-report-portal-check="${r.id}" ${checked(selectedPortal,r.id)}></td><td><b>${esc(r.code)}</b><div class="muted">${esc(r.year)}</div></td><td><b>${esc(r.clientId)}</b><div class="muted">${esc(r.branch||'—')}</div></td><td>${esc(r.matrixId)}</td><td><span class="badge purple">${esc(authLabel(r.authorizationStatus))}</span></td><td>${fmt(r.authorizationDate)}</td><td><button class="btn primary small" data-report-portal-send="${r.id}">Enviar al Portal</button> <button class="btn danger small" data-safe-delete-sample="${r.sampleId}" data-safe-delete-stage="PORTAL">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay informes pendientes de envío al Portal Cliente.</div>';
  if($('reportsPortalSelected'))$('reportsPortalSelected').textContent=`${selectedPortal.size} seleccionados`;
}
function finalFiltered(){
  const q=($('searchReportsFinal')?.value||'').trim().toLowerCase();
  return rows.filter(r=>searchMatch(r,q));
}
function renderFinal(){
  const host=$('reportsFinalTable');if(!host)return;
  const list=finalFiltered();
  host.innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Código</th><th>Cliente / Sucursal</th><th>Matriz</th><th>Analista</th><th>Recepción</th><th>F. máxima</th><th>Entrega real</th><th>Autorización</th><th>F. autorización</th><th>Portal</th><th>Etapa</th></tr></thead><tbody>${list.map(r=>`<tr><td><b>${esc(r.code)}</b><div class="muted">${esc(r.year)}</div></td><td><b>${esc(r.clientId)}</b><div class="muted">${esc(r.branch||'—')}</div></td><td>${esc(r.matrixId)}<div class="muted">${esc(r.groupId||'')}</div></td><td>${esc(r.analyst||'—')}</td><td>${fmt(r.receptionDate)}</td><td>${fmt(r.maxReportDate)}</td><td>${fmt(r.realDeliveryDate)}</td><td>${esc(authLabel(r.authorizationStatus))}</td><td>${fmt(r.authorizationDate)}</td><td>${fmt(r.portalSentDate)}</td><td><span class="badge blue">${esc(stageLabel(r))}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No existen informes con estos filtros.</div>';
  if($('reportsFinalVisible'))$('reportsFinalVisible').textContent=`${list.length} visibles`;
}
function renderAll(){renderStats();renderPending();renderAuthorization();renderPortal();renderFinal()}

async function saveDelivery(id){try{await reportsService.saveRealDelivery(id,$(`reportDelivery_${id}`)?.value,{userId:'LOCAL_USER'});toast('Fecha real guardada. El informe pasó a Autorización.');await api.refresh()}catch(e){toast(e.message||String(e),true)}}
async function saveAuth(id){try{const status=$(`reportAuthStatus_${id}`)?.value;await reportsService.saveAuthorization(id,{status,date:$(`reportAuthDate_${id}`)?.value},{userId:'LOCAL_USER'});toast(isAuthorizationHold(status)?'Estado guardado. El informe permanece en Autorización.':'Autorización guardada. El informe pasó a Portal Cliente.');await api.refresh()}catch(e){toast(e.message||String(e),true)}}
async function sendPortal(id,date=''){try{await reportsService.sendToPortal(id,date||$('reportsPortalBatchDate')?.value||today(),{userId:'LOCAL_USER'});toast('Informe enviado al Portal Cliente.');await api.refresh()}catch(e){toast(e.message||String(e),true)}}
async function batchDelivery(){const date=$('reportsPendingBatchDate')?.value;if(!date){toast('Seleccione la fecha de entrega real.',true);return}const ids=[...selectedPending];if(!ids.length){toast('Seleccione al menos un informe.',true);return}try{for(const id of ids)await reportsService.saveRealDelivery(id,date,{userId:'LOCAL_USER'});selectedPending.clear();toast(`${ids.length} informe(s) enviados a Autorización.`);await api.refresh()}catch(e){toast(e.message||String(e),true)}}
async function batchAuth(){const status=$('reportsAuthBatchStatus')?.value;const hold=isAuthorizationHold(status);const date=hold?'':($('reportsAuthBatchDate')?.value||'');if(!AUTHORIZATION_LABELS[status]){toast('Seleccione el estado de autorización.',true);return}if(!hold&&!date){toast('Seleccione la fecha de autorización.',true);return}const ids=[...selectedAuth];if(!ids.length){toast('Seleccione al menos un informe.',true);return}try{for(const id of ids)await reportsService.saveAuthorization(id,{status,date},{userId:'LOCAL_USER'});selectedAuth.clear();toast(hold?`${ids.length} informe(s) guardados y mantenidos en Autorización.`:`${ids.length} informe(s) enviados a Portal Cliente.`);await api.refresh()}catch(e){toast(e.message||String(e),true)}}
async function batchPortal(){const date=$('reportsPortalBatchDate')?.value||today();const ids=[...selectedPortal];if(!ids.length){toast('Seleccione al menos un informe.',true);return}try{for(const id of ids)await reportsService.sendToPortal(id,date,{userId:'LOCAL_USER'});selectedPortal.clear();toast(`${ids.length} informe(s) enviados al Portal.`);await api.refresh()}catch(e){toast(e.message||String(e),true)}}
function selectVisible(kind,yes){let list=[];if(kind==='pending')list=rows.filter(r=>r.reportStatus==='PENDING_DELIVERY'&&searchMatch(r,($('searchReportsPending')?.value||'').trim().toLowerCase()));if(kind==='auth')list=rows.filter(r=>r.reportStatus==='AUTHORIZATION'&&searchMatch(r,($('searchReportsAuth')?.value||'').trim().toLowerCase()));if(kind==='portal')list=rows.filter(r=>r.reportStatus==='PORTAL_PENDING'&&searchMatch(r,($('searchReportsPortal')?.value||'').trim().toLowerCase()));const set=kind==='pending'?selectedPending:kind==='auth'?selectedAuth:selectedPortal;if(!yes)set.clear();else list.forEach(r=>set.add(r.id));renderAll()}
function excelXmlEscape(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function exportByDate(field,fromId,toId,label,fileTag){
  const from=$(fromId)?.value||'',to=$(toId)?.value||'';
  if(from&&to&&from>to){toast('La fecha Desde no puede ser posterior a Hasta.',true);return}
  const list=rows.filter(r=>{const d=String(r[field]||'').slice(0,10);return d&&(!from||d>=from)&&(!to||d<=to)});
  if(!list.length){toast(`No hay informes con ${label.toLowerCase()} en el rango seleccionado.`,true);return}
  const headers=['CODIGO','ANIO','CLIENTE','SUCURSAL','MATRIZ','GRUPO','ANALISTA','RECEPCION','FECHA_MAXIMA','ENTREGA_REAL','AUTORIZACION','FECHA_AUTORIZACION','PORTAL','ETAPA'];
  const data=list.map(r=>[r.code,r.year,r.clientId,r.branch,r.matrixId,r.groupId,r.analyst,r.receptionDate,r.maxReportDate,r.realDeliveryDate,authLabel(r.authorizationStatus),r.authorizationDate,r.portalSentDate,stageLabel(r)]);
  const border='<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/></Borders>';
  const styles=`<Styles><Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Arial" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style><Style ss:ID="Title"><Font ss:Bold="1" ss:Size="15" ss:Color="#163A2A"/><Interior ss:Color="#EAF4ED" ss:Pattern="Solid"/>${border}</Style><Style ss:ID="Meta"><Font ss:Size="9" ss:Color="#52675A"/><Interior ss:Color="#F6FAF7" ss:Pattern="Solid"/>${border}</Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#17633C" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>${border}</Style><Style ss:ID="Text"><Alignment ss:Vertical="Center" ss:WrapText="1"/>${border}</Style><Style ss:ID="Center"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${border}</Style></Styles>`;
  const widths=[65,50,210,160,85,70,120,90,90,90,230,100,90,120];
  const columns=widths.map(w=>`<Column ss:Width="${w}"/>`).join('');
  const rowXml=data.map(row=>`<Row ss:AutoFitHeight="1">${row.map((v,i)=>`<Cell ss:StyleID="${[0,1,4,5,7,8,9,11,12,13].includes(i)?'Center':'Text'}"><Data ss:Type="String">${excelXmlEscape(v)}</Data></Cell>`).join('')}</Row>`).join('');
  const rangeText=`${from||'Inicio'} a ${to||'Hoy'}`;
  const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${styles}<Worksheet ss:Name="Informes"><Table>${columns}<Row ss:Height="27"><Cell ss:MergeAcross="13" ss:StyleID="Title"><Data ss:Type="String">INFORMES — ${excelXmlEscape(label.toUpperCase())}</Data></Cell></Row><Row ss:Height="22"><Cell ss:MergeAcross="13" ss:StyleID="Meta"><Data ss:Type="String">Período: ${excelXmlEscape(rangeText)} · Registros: ${list.length}</Data></Cell></Row><Row ss:Height="28">${headers.map(h=>`<Cell ss:StyleID="Header"><Data ss:Type="String">${excelXmlEscape(h)}</Data></Cell>`).join('')}</Row>${rowXml}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet></Workbook>`;
  const blob=new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`PEP_INFORMES_${fileTag}_${from||'INICIO'}_A_${to||'HOY'}.xls`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`${list.length} informe(s) exportados a Excel por ${label.toLowerCase()}.`)
}
function exportDelivery(){exportByDate('realDeliveryDate','reportsDeliveryFrom','reportsDeliveryTo','Fecha de entrega real','ENTREGA_REAL')}
function exportAuthorization(){exportByDate('authorizationDate','reportsAuthorizationFrom','reportsAuthorizationTo','Fecha de autorización','AUTORIZACION')}
function exportPortalDate(){exportByDate('portalSentDate','reportsPortalFrom','reportsPortalTo','Fecha de portal','PORTAL')}


const api={
  async refresh(){await reportsService.reconcileDuplicates();await reportsService.ensureFromLaboratory();await reportsService.reconcileAuthorizationHolds();const [reportRows,samples]=await Promise.all([reportsService.all(),repositories.samples.all()]);const activeSampleIds=new Set(samples.map(x=>x.id));rows=visibleForActiveSamples(reportRows,activeSampleIds).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));renderAll()},
  init(){if(initialized)return;initialized=true;
    ['searchReportsPending','searchReportsAuth','searchReportsPortal','searchReportsFinal'].forEach(id=>$(id)?.addEventListener('input',renderAll));
    $('reportsAuthBatchStatus')?.addEventListener('change',()=>{const hold=isAuthorizationHold($('reportsAuthBatchStatus')?.value),date=$('reportsAuthBatchDate'),btn=$('reportsAuthBatchSave');if(date){date.disabled=hold;if(hold)date.value='';else if(!date.value)date.value=today()}if(btn)btn.textContent=hold?'Guardar seleccionados':'Autorizar seleccionados'});
    $('reportsPendingBatchSave')?.addEventListener('click',batchDelivery);$('reportsAuthBatchSave')?.addEventListener('click',batchAuth);$('reportsPortalBatchSend')?.addEventListener('click',batchPortal);$('reportsExportDelivery')?.addEventListener('click',exportDelivery);$('reportsExportAuthorization')?.addEventListener('click',exportAuthorization);$('reportsExportPortal')?.addEventListener('click',exportPortalDate);
    $('reportsPendingSelectVisible')?.addEventListener('click',()=>selectVisible('pending',true));$('reportsPendingClear')?.addEventListener('click',()=>selectVisible('pending',false));
    $('reportsAuthSelectVisible')?.addEventListener('click',()=>selectVisible('auth',true));$('reportsAuthClear')?.addEventListener('click',()=>selectVisible('auth',false));
    $('reportsPortalSelectVisible')?.addEventListener('click',()=>selectVisible('portal',true));$('reportsPortalClear')?.addEventListener('click',()=>selectVisible('portal',false));
    document.addEventListener('change',e=>{const p=e.target.closest('[data-report-pending-check]'),a=e.target.closest('[data-report-auth-check]'),po=e.target.closest('[data-report-portal-check]'),statusEl=e.target.closest('[data-report-auth-status]');if(p){p.checked?selectedPending.add(p.dataset.reportPendingCheck):selectedPending.delete(p.dataset.reportPendingCheck);renderPending()}if(a){a.checked?selectedAuth.add(a.dataset.reportAuthCheck):selectedAuth.delete(a.dataset.reportAuthCheck);renderAuthorization()}if(po){po.checked?selectedPortal.add(po.dataset.reportPortalCheck):selectedPortal.delete(po.dataset.reportPortalCheck);renderPortal()}if(statusEl){const id=statusEl.dataset.reportAuthStatus,hold=isAuthorizationHold(statusEl.value),dateEl=$(`reportAuthDate_${id}`),btn=$(`reportAuthBtn_${id}`);if(dateEl){dateEl.disabled=hold;if(hold)dateEl.value='';else if(!dateEl.value)dateEl.value=today()}if(btn){btn.textContent=hold?'Guardar estado':'Autorizar';btn.classList.toggle('primary',!hold);btn.classList.toggle('secondary',hold)}}});
    document.addEventListener('click',e=>{const d=e.target.closest('[data-report-delivery-save]'),a=e.target.closest('[data-report-auth-save]'),p=e.target.closest('[data-report-portal-send]');if(d)saveDelivery(d.dataset.reportDeliverySave);if(a)saveAuth(a.dataset.reportAuthSave);if(p)sendPortal(p.dataset.reportPortalSend)});
  }
};
export const reportsUI=api;
