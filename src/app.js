import {openDB} from './data/database.js';
import {outboxRepository} from './data/outbox-repository.js';
import {auditRepository} from './data/audit-repository.js';
import {getDeviceId} from './core/device.js';
import {eventBus} from './core/event-bus.js';
import {firebaseCloudAdapterSingleton} from './sync/firebase-cloud-adapter.js';
import {SyncManager} from './sync/sync-manager.js';
import {SyncFoundationUI} from './modules/sync-foundation-ui.js';
import {getLiveSyncManager} from './sync/live-sync-manager.js';
import {GlobalSyncHealthUI} from './modules/global-sync-health.js';
import {sampleRegistryService as service} from './modules/sample-registry.js';
import {laboratoryService as labService} from './modules/laboratory.js';
import {reportsUI} from './modules/reports-ui.js';
import {billingUI} from './modules/billing-ui.js';
import {receivablesUI} from './modules/receivables-ui.js';
import {trackingUI} from './modules/tracking-ui.js';
import {dashboardUI} from './modules/dashboard-ui.js';
import {financialSecurity} from './modules/financial-security.js';
import {historicalValidation} from './modules/historical-validation.js';
import {importVerification} from './modules/import-verification.js';
import {lifecycleDeleteService} from './modules/lifecycle-delete.js';
import {outboxInspector} from './modules/outbox-inspector.js';
import {conflictReviewCenter} from './modules/conflict-review-center.js';
import {securityManager} from './security/security-manager.js';
import {securityFoundationUI} from './modules/security-foundation-ui.js';
import {firestoreRulesValidationUI} from './modules/firestore-rules-validation-ui.js';
import {authenticationInfrastructureUI} from './modules/authentication-infrastructure-ui.js';
import {loginUI} from './modules/login-ui.js';
import {claimsRolesUI} from './modules/claims-roles-ui.js';
import {customClaimsManagerUI} from './modules/custom-claims-manager-ui.js';
import {PermissionUIEnforcer} from './security/permission-ui-enforcer.js';
import {enterpriseUserManagerUI} from './modules/enterprise-user-manager-ui.js';
import {dynamicPermissionUI} from './modules/dynamic-permission-ui.js';
import {EnterpriseSessionGate} from './security/enterprise-session-gate.js';
import {StartupManager} from './core/startup-manager.js';
import {performanceCoordinator} from './core/performance-coordinator.js';
import {NewPcAutoBootstrap} from './modules/new-pc-auto-bootstrap.js';
import {CloudReconciliationManager} from './modules/cloud-reconciliation-manager.js';
import {SyncResilienceManager} from './sync/sync-resilience-manager.js';
import {initEnterpriseTableTools} from './core/enterprise-table-tools.js';

const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let allRows=[],queues={analysis:[],waiting:[],stopped:[],registry:[]},clients=[],matrices=[],lastRegistered=null,importRows=[],importPreviewRows=[],lastImportFileName='',lastImportFormat='',labPending=[],labEntries=[];const adapter=firebaseCloudAdapterSingleton;const syncManager=new SyncManager(adapter);const syncFoundationUI=new SyncFoundationUI(syncManager);const newPcAutoBootstrap=new NewPcAutoBootstrap(adapter);const cloudReconciliationManager=new CloudReconciliationManager(adapter);let liveSyncManager=null;let globalSyncHealthUI=null;let syncResilienceManager=null;let permissionEnforcement=null;
function toast(msg,error=false){const el=$('toast');el.textContent=msg;el.className=`toast show${error?' error':''}`;clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='toast',2800)}
function showError(msg=''){const el=$('formError');el.textContent=msg;el.classList.toggle('show',!!msg)}
function showModule(moduleId){document.querySelectorAll('.module-tab').forEach(x=>x.classList.toggle('active',x.dataset.module===moduleId));document.querySelectorAll('.subnav').forEach(x=>x.classList.toggle('active',x.dataset.subnav===moduleId))}
function showView(id){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===id));performanceCoordinator.mark(`view:${id}`);
const current=document.querySelector(`.tab[data-view="${id}"]`);const owner=current?.dataset.moduleOwner||'monitoring';showModule(owner);document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===id));if(id==='register')setTimeout(()=>$('code').focus(),30);if(['reportsPending','reportsAuthorization','reportsPortal','reportsFinal'].includes(id))reportsUI.refresh().catch(e=>toast(e.message||String(e),true));if(id==='billingControl')billingUI.refresh().catch(e=>toast(e.message||String(e),true));if(id==='receivablesControl')receivablesUI.refresh().catch(e=>toast(e.message||String(e),true));if(id==='trackingCenter')trackingUI.refresh().catch(e=>toast(e.message||String(e),true));if(id==='executiveDashboard')dashboardUI.refresh().catch(e=>toast(e.message||String(e),true));if(id==='syncFoundation'){syncFoundationUI.refresh().catch(e=>toast(e.message||String(e),true));globalSyncHealthUI?.refreshWhenReady?.().catch(e=>toast(e.message||String(e),true))}if(id==='conflictReview')conflictReviewCenter.refresh().catch(e=>toast(e.message||String(e),true));if(id==='securityFoundation'){securityFoundationUI.refresh().catch(e=>toast(e.message||String(e),true));authenticationInfrastructureUI.refresh().catch(e=>toast(e.message||String(e),true));loginUI.refresh().catch(e=>toast(e.message||String(e),true));claimsRolesUI.refresh().catch(e=>toast(e.message||String(e),true));customClaimsManagerUI.refresh().catch(e=>toast(e.message||String(e),true));enterpriseUserManagerUI.refreshHeader();dynamicPermissionUI.refresh();firestoreRulesValidationUI.refresh().catch(e=>toast(e.message||String(e),true))}}
function formatDate(v){if(!v)return '—';const d=new Date(`${String(v).slice(0,10)}T12:00:00`);return Number.isNaN(d.getTime())?esc(v):d.toLocaleDateString('es-EC')}
function statusBadge(s){const d=s.workflow?.decisionStatus||'';if(d==='DETENIDA')return '<span class="badge red">DETENIDA</span>';if(s.workflow?.workflowStage==='WAITING')return '<span class="badge amber">EN ESPERA</span>';if(s.workflow?.workflowStage==='ANALYSIS_REGISTRATION')return '<span class="badge purple">ANÁLISIS</span>';return '<span class="badge green">CONTINUAR</span>'}
function hay(x,q){return !q||[x.code,x.codeFull,x.clientId,x.branch,x.matrixId,x.groupId,x.observations,x.monthFrequency].join(' ').toLowerCase().includes(q)}
function table(rows,kind){if(!rows.length)return '<div class="empty">No hay registros en esta bandeja.</div>';return `<div class="table-wrap"><table><thead><tr><th>Código</th><th>Año</th><th>Cliente / Sucursal</th><th>Matriz / Grupo</th><th>Fecha muestra</th><th>Recepción</th><th>DQO/Tenso</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(x=>{const req=x.workflow?.requirements||{},vals=x.workflow?.analysisValues||{};let actions=`<button class="btn blue small" data-edit="${x.id}">Editar</button> <button class="btn secondary small" data-history="${x.id}">Historial</button> <button class="btn danger small" data-safe-delete-sample="${x.id}" data-safe-delete-stage="MONITORING">Eliminar</button>`;if(kind==='analysis')actions=`<button class="btn primary small" data-analysis="${x.id}">Registrar análisis</button> ${actions}`;if(kind==='waiting')actions=`<button class="btn warning small" data-waiting="${x.id}">Resolver</button> ${actions}`;return `<tr><td><b>${esc(x.code)}</b><div class="muted mono">${esc(x.id.slice(0,8))}…</div></td><td>${esc(x.year)}</td><td><b>${esc(x.clientId)}</b><div class="muted">${esc(x.branch||'—')}</div></td><td><b>${esc(x.matrixId)}</b><div class="muted">${esc(x.groupId)}</div></td><td>${formatDate(x.samplingDate)}</td><td>${formatDate(x.receivedDate)}</td><td>${req.dqo?`DQO: ${esc(vals.dqo||'pendiente')}`:'DQO: —'}<br>${req.surfactants?`Tenso: ${esc(vals.surfactants||'pendiente')}`:'Tenso: —'}</td><td>${statusBadge(x)}</td><td>${actions}</td></tr>`}).join('')}</tbody></table></div>`}
function renderStats(){const today=new Date().toISOString().slice(0,10);const stats=[['Nuevas hoy',allRows.filter(x=>String(x.createdAt).slice(0,10)===today).length],['En análisis',queues.analysis.length],['En espera',queues.waiting.length],['Continuar',queues.registry.filter(x=>x.workflow?.decisionStatus==='CONTINUAR').length],['Detenidas',queues.stopped.length],['Total',allRows.length]];$('registryStats').innerHTML=stats.map(([l,v])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');$('analysisStats').innerHTML=`<div class="stat"><b>${queues.analysis.length}</b><span>Pendientes de análisis</span></div><div class="stat"><b>${queues.analysis.filter(x=>x.workflow?.requirements?.dqo).length}</b><span>Con DQO</span></div><div class="stat"><b>${queues.analysis.filter(x=>x.workflow?.requirements?.surfactants).length}</b><span>Con Tenso</span></div>`}
async function loadCatalogs(){clients=await service.clients();matrices=await service.matrices();$('clientList').innerHTML=clients.map(c=>`<option value="${esc(c.name)}"></option>`).join('');$('matrix').innerHTML=matrices.map(m=>`<option value="${m.id}">${esc(m.label||m.name)}</option>`).join('');updateBranches();renderClientCatalog();renderMatrixCatalog();renderFilterOptions();matrixChanged()}
function updateBranches(){const c=clients.find(x=>String(x.name).toUpperCase()===$('client').value.trim().toUpperCase());$('branchList').innerHTML=(c?.branches||[]).map(b=>`<option value="${esc(b)}"></option>`).join('')}
function renderFilterOptions(){const year=$('filterYear').value,matrix=$('filterMatrix').value;const years=[...new Set(allRows.map(x=>String(x.year)))].sort((a,b)=>b.localeCompare(a));$('filterYear').innerHTML='<option value="">Todos los años</option>'+years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');$('filterYear').value=years.includes(year)?year:'';$('filterMatrix').innerHTML='<option value="">Todas las matrices</option>'+matrices.map(m=>`<option value="${m.id}">${esc(m.label||m.name)}</option>`).join('');$('filterMatrix').value=matrices.some(m=>m.id===matrix)?matrix:''}
function filteredRegistry(){const q=$('searchRegistry').value.trim().toLowerCase(),year=$('filterYear').value,matrixId=$('filterMatrix').value,group=$('filterGroup').value,decision=$('filterDecision').value,from=$('filterFrom').value,to=$('filterTo').value,matrix=matrices.find(m=>m.id===matrixId);return queues.registry.filter(x=>hay(x,q)&&(!year||String(x.year)===year)&&(!matrixId||(x.matrixCatalogId===matrixId||x.matrixId===matrix?.name))&&(!group||x.groupId===group)&&(!decision||x.workflow?.decisionStatus===decision)&&(!from||x.samplingDate>=from)&&(!to||x.samplingDate<=to))}

function registryCodeNumber(value){const m=String(value??'').match(/\d+/g);return m?Number(m.join(''))||0:0}
function registryExcelRows(){return [...filteredRegistry()].sort((a,b)=>{const ad=String(a.samplingDate||''),bd=String(b.samplingDate||'');if(ad!==bd)return bd.localeCompare(ad);const ac=registryCodeNumber(a.code),bc=registryCodeNumber(b.code);if(ac!==bc)return bc-ac;return String(b.code||'').localeCompare(String(a.code||''),'es',{numeric:true})})}
function excelCell(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function exportRegistryExcel(){
  const rows=registryExcelRows();if(!rows.length){toast('No hay muestras visibles para exportar.',true);return}
  const headers=['Código','Año','Cliente','Sucursal','Matriz','Grupo','Fecha de muestra','Fecha de recepción','Frecuencia / mes','DQO','Tensoactivos','Estado','Observaciones','UUID'];
  const cut=new Date().toLocaleString('es-EC');
  const border='<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E3DA"/></Borders>';
  const styles=`<Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
    <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="15" ss:Color="#163A2A"/><Interior ss:Color="#EAF4ED" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${border}</Style>
    <Style ss:ID="Meta"><Font ss:Size="9" ss:Color="#52675A"/><Interior ss:Color="#F6FAF7" ss:Pattern="Solid"/>${border}</Style>
    <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#17633C" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>${border}</Style>
    <Style ss:ID="Text"><Alignment ss:Vertical="Center" ss:WrapText="1"/>${border}</Style>
    <Style ss:ID="Center"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${border}</Style>
    <Style ss:ID="Continue"><Font ss:Bold="1" ss:Color="#08783E"/><Interior ss:Color="#E5F6EC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/>${border}</Style>
    <Style ss:ID="Stopped"><Font ss:Bold="1" ss:Color="#B42318"/><Interior ss:Color="#FDECEB" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/>${border}</Style>
    <Style ss:ID="Waiting"><Font ss:Bold="1" ss:Color="#9A6700"/><Interior ss:Color="#FFF4D6" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/>${border}</Style>
  </Styles>`;
  const widths=[70,55,220,170,90,75,95,95,110,70,85,95,220,210];
  const columns=widths.map(w=>`<Column ss:Width="${w}"/>`).join('');
  const body=rows.map(x=>{
    const req=x.workflow?.requirements||{},vals=x.workflow?.analysisValues||{};
    const state=x.workflow?.decisionStatus||x.workflow?.recordStatus||'';
    const values=[x.code,x.year,x.clientId,x.branch,x.matrixId,x.groupId,x.samplingDate,x.receivedDate,x.monthFrequency,req.dqo?(vals.dqo||''):'',req.surfactants?(vals.surfactants||''):'',state,x.observations,x.id];
    return '<Row ss:AutoFitHeight="1">'+values.map((v,i)=>{let st=(i===0||i===1||i===4||i===5||i===6||i===7||i===9||i===10)?'Center':'Text';if(i===11){const z=String(v||'').toUpperCase();st=z==='DETENIDA'?'Stopped':z==='CONTINUAR'?'Continue':z.includes('ESPERA')?'Waiting':'Center'}return `<Cell ss:StyleID="${st}"><Data ss:Type="String">${excelCell(v)}</Data></Cell>`}).join('')+'</Row>';
  }).join('');
  const head='<Row ss:Height="28">'+headers.map(h=>`<Cell ss:StyleID="Header"><Data ss:Type="String">${excelCell(h)}</Data></Cell>`).join('')+'</Row>';
  const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel">${styles}<Worksheet ss:Name="Registro de Muestras"><Table>${columns}<Row ss:Height="27"><Cell ss:MergeAcross="13" ss:StyleID="Title"><Data ss:Type="String">REGISTRO DE MUESTRAS</Data></Cell></Row><Row ss:Height="22"><Cell ss:MergeAcross="13" ss:StyleID="Meta"><Data ss:Type="String">Generado: ${excelCell(cut)} · Registros: ${rows.length} · Orden: Fecha de muestra ↓ + Código ↓</Data></Cell></Row>${head}${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet></Workbook>`;
  const blob=new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`PEP_REGISTRO_MUESTRAS_${new Date().toISOString().slice(0,10)}.xls`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`${rows.length} muestra(s) exportadas · formato mejorado`)
}
function daysUntil(date){if(!date)return null;const today=new Date();today.setHours(0,0,0,0);const d=new Date(`${date}T12:00:00`);return Math.ceil((d-today)/86400000)}
function labSlaBadge(entry){const n=daysUntil(entry.maxReportDate);if(n===null)return '<span class="badge">SIN FECHA</span>';if(n<0)return `<span class="badge red">VENCIDO · ${Math.abs(n)} día(s)</span>`;if(n<=2)return `<span class="badge amber">${n} día(s)</span>`;return `<span class="badge green">EN PLAZO · ${n} día(s)</span>`}
function labDecisionBadge(s){return s.workflow?.decisionStatus==='DETENIDA'?'<span class="badge red">DETENIDA</span>':'<span class="badge green">CONTINUAR</span>'}
async function loadLaboratory(){await labService.reconcileDuplicateEntries({userId:'SYSTEM_IDENTITY_REPAIR'});labPending=(await labService.eligibleSamples()).sort((a,b)=>(b.receivedDate||b.samplingDate||'').localeCompare(a.receivedDate||a.samplingDate||''));labEntries=(await labService.entries()).filter(x=>x.officialEntryAt).sort((a,b)=>(b.officialEntryAt||'').localeCompare(a.officialEntryAt||''));if($('countLaboratory'))$('countLaboratory').textContent=labPending.length;if($('countLaboratorySub'))$('countLaboratorySub').textContent=labPending.length;renderLaboratory()}
function renderLaboratory(){if(!$('labPendingTable'))return;const qp=$('searchLabPending')?.value.trim().toLowerCase()||'',qw=$('searchLabWorkspace')?.value.trim().toLowerCase()||'';const pend=labPending.filter(x=>hay(x,qp));const work=labEntries.filter(x=>!qw||[x.code,x.codeFull,x.clientId,x.branch,x.matrixId,x.analyst,x.serviceType].join(' ').toLowerCase().includes(qw));const stopped=labPending.filter(x=>x.workflow?.decisionStatus==='DETENIDA').length;const overdue=labEntries.filter(x=>{const n=daysUntil(x.maxReportDate);return n!==null&&n<0}).length;$('labStats').innerHTML=[['Pendientes',labPending.length],['Detenidas visibles',stopped],['En proceso',labEntries.length],['Vencidas',overdue]].map(([l,v])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');$('labPendingTable').innerHTML=pend.length?`<div class="table-wrap"><table><thead><tr><th>Código</th><th>Cliente / Sucursal</th><th>Matriz</th><th>Fecha muestra</th><th>Recepción actual</th><th>Decisión</th><th>Acción</th></tr></thead><tbody>${pend.map(x=>`<tr><td><b>${esc(x.code)}</b><div class="muted">${esc(x.year)}</div></td><td><b>${esc(x.clientId)}</b><div class="muted">${esc(x.branch||'—')}</div></td><td>${esc(x.matrixId)}<div class="muted">${esc(x.groupId)}</div></td><td>${formatDate(x.samplingDate)}</td><td>${formatDate(x.receivedDate)}</td><td>${labDecisionBadge(x)}</td><td><button class="btn primary small" data-lab-open="${x.id}">Cargar / revisar</button> <button class="btn secondary small" data-history="${x.id}">Historial</button> <button class="btn danger small" data-safe-delete-sample="${x.id}" data-safe-delete-stage="LABORATORY">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay muestras pendientes de ingreso oficial.</div>';$('labWorkspaceTable').innerHTML=work.length?`<div class="table-wrap"><table><thead><tr><th>Código</th><th>Cliente / Sucursal</th><th>Analista</th><th>Servicio</th><th>Recepción</th><th>Fecha máxima</th><th>SLA</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${work.map(x=>`<tr><td><b>${esc(x.code)}</b><div class="muted">${esc(x.year)}</div></td><td><b>${esc(x.clientId)}</b><div class="muted">${esc(x.branch||'—')}</div></td><td><input class="billing-input" id="labAnalyst_${x.id}" value="${esc(x.analyst||'')}"></td><td>${esc(x.serviceType||'INTERNO')}</td><td>${formatDate(x.receptionDate)}</td><td><b>${formatDate(x.maxReportDate)}</b></td><td>${labSlaBadge(x)}</td><td><span class="badge blue">EN PROCESO</span></td><td><button class="btn blue small" data-lab-save-analyst="${x.id}">Guardar analista</button> <button class="btn secondary small" data-lab-history="${x.sampleId}">Historial Lab</button> <button class="btn danger small" data-safe-delete-sample="${x.sampleId}" data-safe-delete-stage="LABORATORY">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Todavía no hay ingresos oficiales de Laboratorio.</div>'}
async function loadLabAnalystOptions(){if(!$('labAnalystList'))return;const rows=await labService.analysts();$('labAnalystList').innerHTML=rows.map(x=>`<option value="${esc(x.name||'')}"></option>`).join('')}
function applyLabServiceSla(){if(!$('labServiceType')||!$('labSlaDays'))return;const days=$('labServiceType').value==='EXTERNO'?15:8;$('labSlaDays').value=days;calcLabMaxDate()}
async function openLabEntry(sampleId){try{const sample=allRows.find(x=>x.id===sampleId);if(!sample)throw new Error('Muestra no encontrada.');const entry=await labService.prepare(sampleId,{userId:'LOCAL_USER'});$('labSampleId').value=sampleId;$('labEntryId').value=entry.id;$('labEntrySubtitle').textContent=`${sample.code} · ${sample.year}`;$('labReadonlyClient').textContent=sample.clientId||'—';$('labReadonlyBranch').textContent=sample.branch||'—';$('labReadonlyMatrix').textContent=`${sample.matrixId||'—'}${sample.groupId?' · '+sample.groupId:''}`;await loadLabAnalystOptions();$('labDecisionNotice').innerHTML=sample.workflow?.decisionStatus==='DETENIDA'?'<b>Atención:</b> esta muestra está DETENIDA. Se mantiene visible en Laboratorio por trazabilidad y puede registrarse su ingreso oficial.':'<b>Flujo:</b> muestra habilitada para ingreso oficial al Laboratorio.';$('labDecisionNotice').classList.toggle('warn',sample.workflow?.decisionStatus==='DETENIDA');$('labReceptionDate').value=entry.receptionDate||'';$('labAnalyst').value=entry.analyst||'';$('labServiceType').value=entry.serviceType||'INTERNO';$('labSamplingMonth').value=entry.samplingMonth||'';$('labSlaDays').value=(entry.serviceType||'INTERNO')==='EXTERNO'?15:8;$('labMaxReportDate').value=addLabDays(entry.receptionDate||'',Number($('labSlaDays').value));$('labEntryModal').classList.add('show')}catch(e){toast(e.message||String(e),true)}}
function addLabDays(date,days){if(!date)return '';const x=new Date(`${date}T12:00:00`);if(Number.isNaN(x.getTime()))return '';x.setDate(x.getDate()+Number(days||0));return x.toISOString().slice(0,10)}
function calcLabMaxDate(){const d=$('labReceptionDate').value,n=Number($('labSlaDays').value||8);if(!d)return;$('labMaxReportDate').value=addLabDays(d,n)}
function labInputData(){return {receptionDate:$('labReceptionDate').value,analyst:$('labAnalyst').value,serviceType:$('labServiceType').value,samplingMonth:$('labSamplingMonth').value,slaDays:$('labSlaDays').value,maxReportDate:$('labMaxReportDate').value}}

async function bulkLaboratoryMigration(){
  const total=labPending.length;
  if(!total){toast('No hay muestras pendientes de ingreso oficial.');return}
  if(!confirm(`Se ingresarán oficialmente ${total} muestra(s) pendientes.\n\nSe conservará la fecha de recepción actual de cada muestra y únicamente se asignará Analista = ---.\n\n¿Continuar?`))return;
  const btn=$('bulkLabMigration');
  try{
    if(btn){btn.disabled=true;btn.textContent=`Procesando 0 / ${total}...`}
    toast(`Ingreso masivo iniciado · ${total} muestra(s)...`);
    const result=await labService.bulkOfficialEntryMigration({userId:'MIGRATION_BULK'});
    await refresh();
    toast(`Ingreso masivo completo: ${result.processed} ingresadas${result.skipped?` · ${result.skipped} con error`:''}.`,result.skipped>0);
    showView('reportsPending');
  }catch(e){toast(e.message||String(e),true)}
  finally{if(btn){btn.disabled=false;btn.textContent='📥 Ingresar todas las pendientes'}}
}

async function saveLabDraft(){try{await labService.updateDraft($('labSampleId').value,labInputData(),{userId:'LOCAL_USER'});toast('Datos de Laboratorio guardados localmente.');await loadLaboratory()}catch(e){toast(e.message||String(e),true)}}
async function officialLabEntry(){try{const saved=await labService.officialEntry($('labSampleId').value,labInputData(),{userId:'LOCAL_USER'});$('labEntryModal').classList.remove('show');toast(`Ingreso oficial confirmado · ${saved.code}`);await refresh();showView('laboratory')}catch(e){toast(e.message||String(e),true)}}
async function saveLabAnalyst(entryId){try{await labService.saveAnalyst(entryId,$(`labAnalyst_${entryId}`).value,{userId:'LOCAL_USER'});toast('Analista actualizado.');await loadLaboratory()}catch(e){toast(e.message||String(e),true)}}
async function openLabHistory(sampleId){try{const rows=await labService.auditForSample(sampleId);const sample=allRows.find(x=>x.id===sampleId);$('historyTitle').textContent=`Historial Laboratorio · ${sample?.code||''}`;$('historyRows').innerHTML=rows.length?[...rows].reverse().map(x=>`<div class="timeline-row"><b>${esc(x.action)}</b><div>${esc(x.detail||'')}</div><div class="muted">${esc(new Date(x.at).toLocaleString('es-EC'))} · ${esc(x.userId)}</div></div>`).join(''):'<div class="empty">Sin historial de Laboratorio.</div>';$('historyModal').classList.add('show')}catch(e){toast(e.message||String(e),true)}}

async function refresh(){
  const token=performanceCoordinator.start('refresh:core');
  try{
    allRows=(await service.all()).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
    queues=await service.queues();
    if(allRows.length){
      const s=allRows.reduce((best,x)=>(!best||(x.createdAt||'')>(best.createdAt||''))?x:best,null);
      lastRegistered={client:s.clientId,branch:s.branch,matrixCatalogId:s.matrixCatalogId,samplingDate:s.samplingDate,receivedDate:s.receivedDate,monthFrequency:s.monthFrequency,observations:s.observations,requiresSpecialAnalysis:!!(s.workflow?.requirements?.dqo||s.workflow?.requirements?.surfactants)};
    }
    $('countAnalysis').textContent=queues.analysis.length;$('countWaiting').textContent=queues.waiting.length;$('countStopped').textContent=queues.stopped.length;$('countRegistry').textContent=queues.registry.length;if($('countMonitoring'))$('countMonitoring').textContent=allRows.length;
    await loadCatalogs();renderStats();renderTables();await loadLaboratory();
    await outboxRepository.cleanupConfirmed();
    const [pendingOutbox,audit,health]=await Promise.all([outboxRepository.pending(),auditRepository.all(),adapter.health()]);
    $('dbStatus').textContent='OK';$('sampleCount').textContent=allRows.length;$('outboxCount').textContent=pendingOutbox.length;$('auditCount').textContent=audit.length;$('cloudStatus').textContent=health.provider;$('deviceId').textContent=getDeviceId();if($('catalogClientsCount'))$('catalogClientsCount').textContent=clients.length;if($('catalogBranchesCount'))$('catalogBranchesCount').textContent=clients.reduce((n,c)=>n+(c.branches||[]).length,0);if($('catalogMatricesCount'))$('catalogMatricesCount').textContent=matrices.length;
    // V4.8.0-C: las vistas pesadas se refrescan en segundo plano y no bloquean el primer render.
    performanceCoordinator.scheduleIdle('refresh:secondary',async()=>{
      for(const [name,fn] of [
        ['reports',()=>reportsUI.refresh()],['billing',()=>billingUI.refresh()],['receivables',()=>receivablesUI.refresh()],['tracking',()=>trackingUI.refresh()],['dashboard',()=>dashboardUI.refresh()]
      ]){
        try{const t=performanceCoordinator.start(`module:${name}`);await fn();performanceCoordinator.end(t)}catch(e){console.warn(`Refresh diferido ${name}:`,e)}
      }
      performanceCoordinator.renderPanel();
    });
  }finally{performanceCoordinator.end(token);performanceCoordinator.renderPanel()}
}

function renderTables(){const aq=$('searchAnalysis').value.trim().toLowerCase(),wq=$('searchWaiting').value.trim().toLowerCase(),sq=$('searchStopped').value.trim().toLowerCase();$('analysisTable').innerHTML=table(queues.analysis.filter(x=>hay(x,aq)),'analysis');$('waitingTable').innerHTML=table(queues.waiting.filter(x=>hay(x,wq)),'waiting');$('stoppedTable').innerHTML=table(queues.stopped.filter(x=>hay(x,sq)),'stopped');const r=filteredRegistry();$('registryTable').innerHTML=table(r,'registry');$('registryResultCount').textContent=`${r.length} visible${r.length===1?'':'s'}`}
function formData(){const special=$('requiresSpecialAnalysis').checked;return {code:$('code').value,year:$('year').value,client:$('client').value,branch:$('branch').value,matrixCatalogId:$('matrix').value,samplingDate:$('samplingDate').value,receivedDate:$('receivedDate').value,monthFrequency:$('monthFrequency').value,requiresDqo:special,requiresSurfactants:special,observations:$('observations').value}}
function clearForm(){const matrix=$('matrix').value;$('sampleForm').reset();$('editId').value='';$('year').value=new Date().getFullYear();$('samplingDate').value=new Date().toISOString().slice(0,10);$('saveBtn').textContent='Guardar muestra';$('requiresSpecialAnalysis').disabled=false;if(matrix&&matrices.some(m=>m.id===matrix))$('matrix').value=matrix;showError();matrixChanged();$('code').focus()}
function matrixChanged(){const x=matrices.find(m=>m.id===$('matrix').value);$('matrixGroup').innerHTML=x?`<b>${esc(x.groupId)}</b> · Familia ${esc(x.codeFamily)}`:'—'}
async function submit(e){e.preventDefault();showError();try{const id=$('editId').value;if(id){await service.updateRegistry(id,formData(),{userId:'LOCAL_USER'});toast('Datos de la muestra actualizados localmente.')}else{const saved=await service.register(formData(),{userId:'LOCAL_USER'});toast(saved.workflow.workflowStage==='ANALYSIS_REGISTRATION'?'Muestra guardada. Pasa a Registro de Análisis.':'Muestra guardada. Ingreso culminado.')}clearForm();await refresh();if(!id&&allRows[0]?.workflow?.workflowStage==='ANALYSIS_REGISTRATION')showView('analysis')}catch(err){showError(err.message||String(err));toast(err.message||String(err),true)}}
function repeatLast(){if(!lastRegistered){toast('Todavía no hay una última muestra registrada.',true);return}$('client').value=lastRegistered.client||'';$('branch').value=lastRegistered.branch||'';if(lastRegistered.matrixCatalogId&&matrices.some(m=>m.id===lastRegistered.matrixCatalogId))$('matrix').value=lastRegistered.matrixCatalogId;$('samplingDate').value=lastRegistered.samplingDate||new Date().toISOString().slice(0,10);$('receivedDate').value=lastRegistered.receivedDate||'';$('monthFrequency').value=lastRegistered.monthFrequency||'';$('observations').value=lastRegistered.observations||'';$('requiresSpecialAnalysis').checked=!!lastRegistered.requiresSpecialAnalysis;$('code').value='';updateBranches();matrixChanged();$('code').focus();toast('Datos repetidos. Ingrese el nuevo código.')}
function openAnalysis(id){const s=allRows.find(x=>x.id===id);if(!s)return;$('analysisId').value=id;$('analysisTitle').textContent=`Análisis · ${s.code}`;$('analysisSubtitle').textContent=`${s.clientId} · ${s.matrixId}`;const req=s.workflow.requirements||{};$('dqoValue').disabled=!req.dqo;$('surfactantValue').disabled=!req.surfactants;$('dqoValue').value=s.workflow.analysisValues?.dqo||'';$('surfactantValue').value=s.workflow.analysisValues?.surfactants||'';$('analysisModal').classList.add('show')}
function openWaiting(id){const s=allRows.find(x=>x.id===id);if(!s)return;$('waitingId').value=id;$('waitingTitle').textContent=`Decisión · ${s.code}`;$('waitingReason').value='';$('waitingModal').classList.add('show')}
function openEdit(id){const s=allRows.find(x=>x.id===id);if(!s)return;showView('register');$('editId').value=id;$('code').value=s.code;$('year').value=s.year;$('client').value=s.clientId;$('branch').value=s.branch||'';const matrix=matrices.find(m=>m.id===s.matrixCatalogId)||matrices.find(m=>m.name===s.matrixId);if(matrix)$('matrix').value=matrix.id;$('samplingDate').value=s.samplingDate||'';$('receivedDate').value=s.receivedDate||'';$('monthFrequency').value=s.monthFrequency||'';$('observations').value=s.observations||'';$('requiresSpecialAnalysis').checked=!!(s.workflow?.requirements?.dqo||s.workflow?.requirements?.surfactants);$('requiresSpecialAnalysis').disabled=true;$('saveBtn').textContent='Guardar cambios';matrixChanged();updateBranches()}
async function openHistory(id){const s=allRows.find(x=>x.id===id);if(!s)return;$('historyTitle').textContent=`Trazabilidad · ${s.code}`;const workflow=s.workflow?.history||[],audit=await service.auditFor(id);let html='<div class="notice"><b>Workflow</b></div>';html+=workflow.length?workflow.slice().reverse().map(h=>`<div class="timeline-row"><b>${esc(h.action)}</b><div>${esc(h.from)} → ${esc(h.to)}</div><div class="muted">${new Date(h.at).toLocaleString('es-EC')} · ${esc(h.userId)}</div></div>`).join(''):'<div class="empty">Sin movimientos de workflow.</div>';html+='<div class="notice" style="margin-top:10px"><b>Auditoría del repositorio</b></div>';html+=audit.length?audit.map(a=>`<div class="timeline-row"><b>${esc(a.action)} · ${esc(a.domain)}</b><div class="muted">${new Date(a.createdAt).toLocaleString('es-EC')} · ${esc(a.userId)}</div></div>`).join(''):'<div class="empty">Sin auditoría.</div>';$('historyRows').innerHTML=html;$('historyModal').classList.add('show')}
async function analysisAction(wait){try{const id=$('analysisId').value,values={dqo:$('dqoValue').value,surfactants:$('surfactantValue').value};if(wait)await service.sendToWaiting(id,values,{userId:'LOCAL_USER'});else await service.registerAnalysis(id,values,{userId:'LOCAL_USER'});$('analysisModal').classList.remove('show');toast(wait?'Muestra enviada a En Espera.':'Análisis registrado. Muestra cerrada en Registro.');await refresh()}catch(e){toast(e.message||String(e),true)}}
async function waitingAction(stop){try{const id=$('waitingId').value,reason=$('waitingReason').value;if(stop)await service.stopWaiting(id,reason,{userId:'LOCAL_USER'});else await service.continueWaiting(id,reason,{userId:'LOCAL_USER'});$('waitingModal').classList.remove('show');toast(stop?'Muestra marcada DETENIDA.':'Muestra marcada CONTINUAR.');await refresh()}catch(e){toast(e.message||String(e),true)}}
function clearClientForm(){ $('catalogClientId').value='';$('catalogClientName').value='';$('catalogClientIdentification').value='';$('catalogBranches').innerHTML='';addBranchLine('');$('deleteCatalogClient').style.display='none'}
function addBranchLine(value=''){const row=document.createElement('div');row.className='branch-line';row.innerHTML=`<input class="catalogBranchInput" placeholder="Sucursal / lugar" value="${esc(value)}"><button class="btn danger small" type="button">×</button>`;row.querySelector('button').onclick=()=>row.remove();$('catalogBranches').appendChild(row)}
function renderClientCatalog(){const q=$('clientCatalogSearch')?.value.trim().toLowerCase()||'',rows=clients.filter(c=>!q||[c.name,c.identification,...(c.branches||[])].join(' ').toLowerCase().includes(q));if($('clientCatalogList'))$('clientCatalogList').innerHTML=rows.length?rows.map(c=>`<div class="catalog-row" data-client-catalog="${c.id}"><div><b>${esc(c.name)}</b><div class="muted">${esc(c.identification||'Sin identificación')} · ${(c.branches||[]).length} sucursal(es)</div></div><button class="btn secondary small" type="button">Editar</button></div>`).join(''):'<div class="empty">Sin clientes.</div>'}
function editClientCatalog(id){const c=clients.find(x=>x.id===id);if(!c)return;$('catalogClientId').value=c.id;$('catalogClientName').value=c.name;$('catalogClientIdentification').value=c.identification||'';$('catalogBranches').innerHTML='';(c.branches||[]).forEach(addBranchLine);if(!(c.branches||[]).length)addBranchLine('');$('deleteCatalogClient').style.display='inline-block'}
async function saveClientCatalog(){try{const branches=[...document.querySelectorAll('.catalogBranchInput')].map(x=>x.value);await service.saveClientCatalog({id:$('catalogClientId').value||undefined,name:$('catalogClientName').value,identification:$('catalogClientIdentification').value,branches},{userId:'LOCAL_USER'});toast('Cliente guardado.');await refresh();clearClientForm()}catch(e){toast(e.message||String(e),true)}}
async function deleteClientCatalog(){const id=$('catalogClientId').value;if(!id)return;try{await service.deleteClientCatalog(id,{userId:'LOCAL_USER'});toast('Cliente eliminado.');await refresh();clearClientForm()}catch(e){toast(e.message||String(e),true)}}
function renderMatrixCatalog(){if(!$('matrixCatalogList'))return;$('matrixCatalogList').innerHTML=matrices.length?matrices.map(m=>`<div class="catalog-row" data-matrix-catalog="${m.id}"><div><b>${esc(m.label||m.name)}</b><div class="muted">${esc(m.name)} · ${esc(m.groupId)}</div></div><button class="btn secondary small" type="button">Editar</button></div>`).join(''):'<div class="empty">Sin matrices.</div>'}
function clearMatrixForm(){$('catalogMatrixId').value='';$('catalogMatrixName').value='';$('catalogMatrixLabel').value='';$('catalogMatrixGroup').value='AGUA';$('deleteCatalogMatrix').style.display='none'}
function editMatrixCatalog(id){const m=matrices.find(x=>x.id===id);if(!m)return;$('catalogMatrixId').value=m.id;$('catalogMatrixName').value=m.name;$('catalogMatrixLabel').value=m.label||m.name;$('catalogMatrixGroup').value=m.groupId;$('deleteCatalogMatrix').style.display='inline-block'}
async function saveMatrixCatalog(){try{await service.saveMatrixCatalog({id:$('catalogMatrixId').value||undefined,name:$('catalogMatrixName').value,label:$('catalogMatrixLabel').value,groupId:$('catalogMatrixGroup').value},{userId:'LOCAL_USER'});toast('Matriz guardada.');await refresh();clearMatrixForm()}catch(e){toast(e.message||String(e),true)}}
async function deleteMatrixCatalog(){const id=$('catalogMatrixId').value;if(!id)return;try{await service.deleteMatrixCatalog(id,{userId:'LOCAL_USER'});toast('Matriz eliminada.');await refresh();clearMatrixForm()}catch(e){toast(e.message||String(e),true)}}
async function quickBranch(){const name=$('client').value.trim();if(!name){toast('Primero seleccione o escriba un cliente.',true);return}const c=clients.find(x=>x.name.toUpperCase()===name.toUpperCase());$('clientsModal').classList.add('show');if(c)editClientCatalog(c.id);else{clearClientForm();$('catalogClientName').value=name}$('catalogBranches').querySelector('input:last-of-type')?.focus()}
function normalizeHeader(v){return String(v??'').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'')}
const IMPORT_HEADER_ALIASES={
 DATE:['FECHA','FECHA_DE_MUESTRA','FECHA_MUESTRA','FECHA_MUESTREO'],
 CODE:['CODIGO','CODIGO_MANUAL','COD'],
 YEAR:['ANO','ANIO','YEAR'],
 MATRIX:['MATRIZ','MATRIX'],
 GROUP:['GRUPO','GROUP'],
 CLIENT:['CLIENTE','CLIENT','EMPRESA'],
 BRANCH:['SUCURSAL','SEDE','LUGAR','PUNTO'],
 MONTH:['MES_FRECUENCIA','FRECUENCIA_MES','MES','FRECUENCIA'],
 DQO:['DQO'],
 SURF:['TENSOACTIVOS','TENSOACTIVO','TENSO'],
 DECISION:['STATUS','DECISION','STATUS_DECISION','ESTADO_FLUJO'],
 STATE:['ESTADO','STATE'],
 OBS:['OBSERVACIONES','OBSERVACION','NOTAS'],
 ANALYST:['ANALISTA'],
 TYPE:['TIPO','TIPO_SERVICIO','SERVICIO'],
 RECEIVED:['FECHA_DE_RECEPCION','FECHA_RECEPCION','RECEPCION'],
 SAMPLE_ID:['SAMPLE_ID','UUID','ID_MUESTRA']
};
function aliasHit(headers,key){const vals=IMPORT_HEADER_ALIASES[key]||[];return vals.find(v=>headers.includes(v))||''}
function detectHeaderRow(matrix){
 for(let i=0;i<matrix.length;i++){
  const headers=(matrix[i]||[]).map(normalizeHeader);
  const found={code:aliasHit(headers,'CODE'),year:aliasHit(headers,'YEAR'),matrix:aliasHit(headers,'MATRIX'),client:aliasHit(headers,'CLIENT'),date:aliasHit(headers,'DATE')};
  if(found.code&&found.year&&found.matrix&&found.client&&found.date)return {index:i,headers};
 }
 return null;
}
function excelDate(v){if(!v)return '';if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);if(typeof v==='number'){if(window.XLSX?.SSF?.parse_date_code){const d=XLSX.SSF.parse_date_code(v);if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}const epoch=new Date(Date.UTC(1899,11,30));const d=new Date(epoch.getTime()+Number(v)*86400000);if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10)}const s=String(v).trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return ''}
function loadXLSX(){if(window.XLSX)return Promise.resolve(window.XLSX);return new Promise((resolve,reject)=>{const old=document.getElementById('xlsxLoader');if(old){if(window.XLSX)return resolve(window.XLSX);old.addEventListener('load',()=>resolve(window.XLSX),{once:true});old.addEventListener('error',()=>reject(new Error('No se pudo cargar el lector universal de Excel. Para .xlsx o .xls binario se requiere acceso temporal al lector SheetJS. CSV y XLS-HTML funcionan localmente.')),{once:true});return}const sc=document.createElement('script');sc.id='xlsxLoader';sc.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';sc.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('Lector Excel no disponible.'));sc.onerror=()=>reject(new Error('No se pudo cargar el lector .xlsx/.xls. Compruebe internet o use CSV / XLS-HTML.'));document.head.appendChild(sc)})}
function pickValue(x,key){for(const alias of (IMPORT_HEADER_ALIASES[key]||[])){if(x[alias]!==undefined&&x[alias]!==null&&String(x[alias]).trim()!=='')return x[alias]}return ''}
function mappedImportRow(x,sourceRow){let code=String(pickValue(x,'CODE')).trim(),year=Number(pickValue(x,'YEAR')||0);const cm=code.match(/^(.+?)[\s-]+(20\d{2})$/);if(cm&&!year){code=cm[1];year=Number(cm[2])}return {sourceRow,code,year,matrixId:String(pickValue(x,'MATRIX')).trim(),groupId:String(pickValue(x,'GROUP')).trim().toUpperCase(),client:String(pickValue(x,'CLIENT')).trim(),branch:String(pickValue(x,'BRANCH')).trim(),samplingDate:excelDate(pickValue(x,'DATE')),receivedDate:excelDate(pickValue(x,'RECEIVED')),analyst:String(pickValue(x,'ANALYST')).trim(),serviceType:String(pickValue(x,'TYPE')||'INTERNO').trim(),monthFrequency:String(pickValue(x,'MONTH')).trim(),dqo:String(pickValue(x,'DQO')).trim(),surfactants:String(pickValue(x,'SURF')).trim(),decision:String(pickValue(x,'DECISION')||'CONTINUAR').trim().toUpperCase(),state:String(pickValue(x,'STATE')||'INGRESADA').trim().toUpperCase(),observations:String(pickValue(x,'OBS')).trim(),sampleId:String(pickValue(x,'SAMPLE_ID')).trim()}}
function decodeHtmlCell(html){const box=document.createElement('textarea');box.innerHTML=String(html??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'');return String(box.value||'').replace(/\u00a0/g,' ').trim()}
function matrixToImportRows(matrix){const hit=detectHeaderRow(matrix);if(!hit){const sample=matrix.slice(0,8).map(r=>(r||[]).join(' | ')).filter(Boolean).join(' / ');throw new Error('No se encontró una fila de encabezados compatible. Primeras filas: '+sample.slice(0,260))}const {index,headers}=hit;return matrix.slice(index+1).map((arr,i)=>{const x={};headers.forEach((h,j)=>{if(h)x[h]=arr[j]??''});return mappedImportRow(x,index+i+2)}).filter(r=>r.code||r.client||r.matrixId)}
function parsePepHtmlXls(text){text=String(text||'').replace(/^\uFEFF/,'').replace(/\u0000/g,'');const trMatches=[...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];if(!trMatches.length)throw new Error('El archivo .xls HTML no contiene filas reconocibles.');const matrix=trMatches.map(m=>[...m[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(c=>decodeHtmlCell(c[1])));return matrixToImportRows(matrix)}
function detectDelimiter(text){const first=String(text||'').split(/\r?\n/).find(x=>x.trim())||'';const candidates=[',',';','\t','|'];let best=',',count=-1;for(const d of candidates){let n=0,q=false;for(let i=0;i<first.length;i++){if(first[i]==='"'){if(q&&first[i+1]==='"')i++;else q=!q}else if(!q&&first[i]===d)n++}if(n>count){count=n;best=d}}return best}
function parseDelimited(text,delimiter){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(q&&text[i+1]==='"'){cell+='"';i++}else q=!q}else if(!q&&ch===delimiter){row.push(cell);cell=''}else if(!q&&(ch==='\n'||ch==='\r')){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(v=>String(v).trim()))rows.push(row);row=[]}else cell+=ch}row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);return rows}
function parseCsv(text){return matrixToImportRows(parseDelimited(String(text||'').replace(/^\uFEFF/,''),detectDelimiter(text)))}
async function parseExcel(file){
 const name=String(file.name||'').toLowerCase(),ext=(name.split('.').pop()||'').toLowerCase();
 const buf=await file.arrayBuffer();let text='';try{text=new TextDecoder('utf-8').decode(buf)}catch{}text=String(text||'').replace(/^\uFEFF/,'').replace(/\u0000/g,'');
 const looksHtml=/<(?:html|table|tr|td|th)\b/i.test(text)&&/(C[oó]digo|CODIGO)/i.test(text);
 if(looksHtml)return {rows:parsePepHtmlXls(text),format:'XLS HTML'};
 if(ext==='csv'||/^(text\/csv|text\/plain)/i.test(file.type||''))return {rows:parseCsv(text),format:'CSV'};
 const XLSX=await loadXLSX();let wb;try{wb=XLSX.read(buf,{type:'array',cellDates:true})}catch(err){if(looksHtml)return {rows:parsePepHtmlXls(text),format:'XLS HTML'};throw new Error('No se pudo leer el archivo '+file.name+': '+(err.message||err))}
 const sheetName=wb.SheetNames.find(n=>normalizeHeader(n)==='MUESTRAS')||wb.SheetNames.find(n=>normalizeHeader(n)!=='INSTRUCCIONES')||wb.SheetNames[0];if(!sheetName)throw new Error('El libro no contiene hojas.');const sheet=wb.Sheets[sheetName];const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});return {rows:matrixToImportRows(matrix),format:(ext==='xls'?'XLS':'XLSX')+' · '+sheetName}
}
function previewImport(rows){importRows=rows;const existing=new Set(allRows.map(x=>`${String(x.codeFull).toUpperCase()}|${x.groupId}`));const matrixMap=new Map(matrices.map(m=>[String(m.name).toUpperCase(),m]));importPreviewRows=rows.map(r=>{const m=matrixMap.get(String(r.matrixId).toUpperCase());const errors=[];if(!r.code)errors.push('CODIGO');if(!Number.isInteger(Number(r.year))||Number(r.year)<2000||Number(r.year)>2100)errors.push('ANIO');if(!m)errors.push('MATRIZ');if(!r.client)errors.push('CLIENTE');if(!r.branch)errors.push('SUCURSAL');if(!r.samplingDate)errors.push('FECHA');if(r.decision&&!['CONTINUAR','DETENIDA'].includes(r.decision))errors.push('DECISION');if(r.state&&r.state!=='INGRESADA')errors.push('ESTADO');const key=m?`${String(r.code).toUpperCase()}-${r.year}|${m.groupId}`:'';return {...r,matrixCatalogId:m?.id||'',derivedGroup:m?.groupId||'',duplicate:!!key&&existing.has(key),errors}});const valid=importPreviewRows.filter(x=>!x.errors.length).length,dups=importPreviewRows.filter(x=>x.duplicate&&!x.errors.length).length,errs=importPreviewRows.filter(x=>x.errors.length).length;$('importTotal').textContent=rows.length;$('importValid').textContent=valid;$('importDuplicates').textContent=dups;$('importErrorsCount').textContent=errs;$('importPreview').classList.remove('hidden');const sample=importPreviewRows.slice(0,50);$('importTable').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Fila</th><th>Código</th><th>Año</th><th>Cliente</th><th>Matriz</th><th>Grupo</th><th>Fecha</th><th>DQO/Tenso</th><th>Decisión</th><th>Validación</th></tr></thead><tbody>${sample.map(x=>`<tr><td>${x.sourceRow}</td><td><b>${esc(x.code)}</b></td><td>${esc(x.year)}</td><td>${esc(x.client)}</td><td>${esc(x.matrixId)}</td><td>${esc(x.derivedGroup||x.groupId)}</td><td>${formatDate(x.samplingDate)}</td><td>${esc(x.dqo||'—')} / ${esc(x.surfactants||'—')}</td><td>${esc(x.decision)}</td><td>${x.errors.length?`<span class="badge red">${esc(x.errors.join(', '))}</span>`:x.duplicate?'<span class="badge amber">DUPLICADO</span>':'<span class="badge green">OK</span>'}</td></tr>`).join('')}</tbody></table></div>${importPreviewRows.length>50?`<div class="muted" style="margin-top:6px">Vista previa: primeras 50 de ${importPreviewRows.length} filas.</div>`:''}`;const bad=importPreviewRows.filter(x=>x.errors.length);$('importErrors').classList.toggle('hidden',!bad.length);$('importErrors').innerHTML=bad.length?`<b>Filas con error (${bad.length}):</b><br>${bad.slice(0,100).map(x=>`Fila ${x.sourceRow}: ${esc(x.errors.join(', '))}`).join('<br>')}`:''}
function validImportPayload(){return importPreviewRows.filter(x=>!x.errors.length).map(x=>({sourceRow:x.sourceRow,code:x.code,year:Number(x.year),client:x.client,branch:x.branch,matrixId:x.matrixId,matrixCatalogId:x.matrixCatalogId,groupId:x.derivedGroup||x.groupId,samplingDate:x.samplingDate,receivedDate:x.receivedDate,monthFrequency:x.monthFrequency,dqo:x.dqo,surfactants:x.surfactants,decision:x.decision,state:x.state,observations:x.observations,analyst:x.analyst,serviceType:x.serviceType,sampleId:x.sampleId,requiresSpecialAnalysis:!!(x.dqo||x.surfactants)}))}
async function runImportVerification(rows=null){try{const source=rows?.length?rows:validImportPayload();const out=await importVerification.compare(source.length?source:null,{fileName:lastImportFileName,format:lastImportFormat});importVerification.render($('importVerificationPanel'),out.result,out.manifest);if($('expectedHistoricalTotal')&&out.result.sourceCount)$('expectedHistoricalTotal').value=out.result.sourceCount;const recover=$('recoverSingleMissingImport');if(recover)recover.addEventListener('click',recoverSingleMissingImport,{once:true});toast(out.result.missing.length?`Verificación: ${out.result.missing.length} registro(s) faltante(s).`:'Importación verificada: todas las filas existen en samples.',!!out.result.missing.length);return out}catch(e){toast(e.message||String(e),true);throw e}}
async function recoverSingleMissingImport(){const row=importVerification.getSingleMissing();if(!row){toast('No existe exactamente un registro faltante para recuperar.',true);return}try{const btn=$('recoverSingleMissingImport');if(btn){btn.disabled=true;btn.textContent='Recuperando...'}const result=await service.importHistorical([row],{userId:'IMPORT_RECOVERY',updateDuplicates:false});await refresh();await runImportVerification();await runHistoricalValidation();toast(result.created===1?`Registro ${row.code}-${row.year} recuperado correctamente.`:`No fue posible crear el registro faltante. Creados: ${result.created}.`,result.created!==1)}catch(e){toast(e.message||String(e),true)}}
async function excelSelected(){const file=$('excelFile').files?.[0];if(!file)return;try{toast('Leyendo Excel...');const parsed=await parseExcel(file);const rows=parsed.rows||[];if(!rows.length)throw new Error('El archivo no contiene filas de muestras.');lastImportFileName=file.name;lastImportFormat=parsed.format||'Detectado';previewImport(rows);if($('importFormat'))$('importFormat').textContent=lastImportFormat;if($('expectedHistoricalTotal'))$('expectedHistoricalTotal').value=rows.length;await importVerification.saveManifest(validImportPayload(),{fileName:lastImportFileName,format:lastImportFormat});toast(`${rows.length} fila(s) leídas · ${lastImportFormat}. Revise la vista previa.`)}catch(e){toast(e.message||String(e),true);$('excelFile').value=''}}
async function confirmImport(){const valid=validImportPayload();if(!valid.length){toast('No hay filas válidas para importar.',true);return}try{$('confirmImport').disabled=true;$('confirmImport').textContent='Importando...';await importVerification.saveManifest(valid,{fileName:lastImportFileName,format:lastImportFormat});const result=await service.importHistorical(valid,{userId:'EXCEL_IMPORT',updateDuplicates:$('updateDuplicates').checked});await refresh();toast(`Importación completa: ${result.created} nuevas, ${result.updated} actualizadas, ${result.skipped} omitidas.`);if(result.errors.length)console.warn('Errores de importación',result.errors);showView('import');await runImportVerification(valid);await runHistoricalValidation();cancelImport()}catch(e){toast(e.message||String(e),true)}finally{$('confirmImport').disabled=false;$('confirmImport').textContent='Importar filas válidas'}}
function cancelImport(){importRows=[];importPreviewRows=[];$('excelFile').value='';$('importPreview').classList.add('hidden');$('importTable').innerHTML='';$('importErrors').innerHTML='';$('updateDuplicates').checked=false}

async function runHistoricalValidation(){try{const expected=Number($('expectedHistoricalTotal')?.value||0);const result=await historicalValidation.run(expected);historicalValidation.render($('historicalValidationPanel'),result);toast(result.validation.totalMatches&&!result.validation.duplicates.length&&!result.validation.issues.length?'Base local validada correctamente.':'Validación terminada: revise las incidencias mostradas.')}catch(e){toast(e.message||String(e),true)}}
async function downloadMasterBackup(){try{await runHistoricalValidation();const expected=Number($('expectedHistoricalTotal')?.value||0);const v=await historicalValidation.downloadMaster(expected);toast(`Respaldo maestro generado con ${v.total} muestras.`)}catch(e){toast(e.message||String(e),true)}}

function openClientsCatalog(){$('clientsModal').classList.add('show');clearClientForm();renderClientCatalog()}
function openMatricesCatalog(){$('matricesModal').classList.add('show');clearMatrixForm();renderMatrixCatalog()}

function clearFilters(){['searchRegistry','filterYear','filterMatrix','filterGroup','filterDecision','filterFrom','filterTo'].forEach(id=>$(id).value='');renderTables()}

if($('searchLabPending'))$('searchLabPending').addEventListener('input',renderLaboratory);if($('searchLabWorkspace'))$('searchLabWorkspace').addEventListener('input',renderLaboratory);if($('labReceptionDate'))$('labReceptionDate').addEventListener('change',calcLabMaxDate);if($('labServiceType'))$('labServiceType').addEventListener('change',applyLabServiceSla);if($('saveLabDraft'))$('saveLabDraft').addEventListener('click',saveLabDraft);if($('officialLabEntry'))$('officialLabEntry').addEventListener('click',officialLabEntry);if($('bulkLabMigration'))$('bulkLabMigration').addEventListener('click',bulkLaboratoryMigration);
document.querySelectorAll('.module-tab').forEach(b=>b.addEventListener('click',async()=>{const m=b.dataset.module;if(permissionEnforcement&&!permissionEnforcement.canOpenModule(m)){toast('Módulo no autorizado para el rol actual.',true);return}if(financialSecurity.isFinancial(m)&&!await financialSecurity.requestAccess())return;showModule(m);const first=[...document.querySelectorAll(`.subnav[data-subnav="${m}"] .tab[data-view]`)].find(x=>!x.hidden&&(!permissionEnforcement||permissionEnforcement.canOpenView(x.dataset.view,m)));if(first)showView(first.dataset.view)}));document.querySelectorAll('.tab[data-view]').forEach(b=>b.addEventListener('click',async()=>{const owner=b.dataset.moduleOwner;if(permissionEnforcement&&!permissionEnforcement.canOpenView(b.dataset.view,owner)){toast('Vista no autorizada para el rol actual.',true);return}if(financialSecurity.isFinancial(owner)&&!await financialSecurity.requestAccess())return;showView(b.dataset.view)}));document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).classList.remove('show')));['searchAnalysis','searchWaiting','searchStopped','searchRegistry','filterYear','filterMatrix','filterGroup','filterDecision','filterFrom','filterTo'].forEach(id=>$(id).addEventListener(id.startsWith('search')?'input':'change',renderTables));$('sampleForm').addEventListener('submit',submit);$('clearBtn').addEventListener('click',clearForm);$('repeatBtn').addEventListener('click',repeatLast);$('matrix').addEventListener('change',matrixChanged);$('client').addEventListener('input',updateBranches);$('analysisContinue').addEventListener('click',()=>analysisAction(false));$('analysisWait').addEventListener('click',()=>analysisAction(true));$('waitingContinue').addEventListener('click',()=>waitingAction(false));$('waitingStop').addEventListener('click',()=>waitingAction(true));$('clearFilters').addEventListener('click',clearFilters);$('exportRegistryExcel').addEventListener('click',exportRegistryExcel);$('openClients').addEventListener('click',openClientsCatalog);$('quickBranch').addEventListener('click',quickBranch);$('openMatrices').addEventListener('click',openMatricesCatalog);$('manageClients').addEventListener('click',openClientsCatalog);$('manageMatrices').addEventListener('click',openMatricesCatalog);$('excelFile').addEventListener('change',excelSelected);$('confirmImport').addEventListener('click',confirmImport);$('cancelImport').addEventListener('click',cancelImport);if($('runImportVerification'))$('runImportVerification').addEventListener('click',()=>runImportVerification());if($('verifyImportPreview'))$('verifyImportPreview').addEventListener('click',()=>runImportVerification());if($('runHistoricalValidation'))$('runHistoricalValidation').addEventListener('click',runHistoricalValidation);if($('downloadMasterBackup'))$('downloadMasterBackup').addEventListener('click',downloadMasterBackup);$('clientCatalogSearch').addEventListener('input',renderClientCatalog);$('newClientCatalog').addEventListener('click',clearClientForm);$('addCatalogBranch').addEventListener('click',()=>addBranchLine(''));$('saveCatalogClient').addEventListener('click',saveClientCatalog);$('deleteCatalogClient').addEventListener('click',deleteClientCatalog);$('newMatrixCatalog').addEventListener('click',clearMatrixForm);$('saveCatalogMatrix').addEventListener('click',saveMatrixCatalog);$('deleteCatalogMatrix').addEventListener('click',deleteMatrixCatalog);
async function safeDeleteSample(sampleId,stage){
  try{
    const check=await lifecycleDeleteService.canDeleteFrom(sampleId,stage);
    if(!check.allowed){toast(`Este código está actualmente en ${check.currentLabel}. Elimínelo desde esa etapa.`,true);return}
    const sample=allRows.find(x=>x.id===sampleId);
    const code=sample?.codeFull||sample?.code||'este código';
    if(!confirm(`¿Eliminar ${code} definitivamente del flujo?\n\nEtapa actual: ${check.currentLabel}\nSe eliminarán coordinadamente sus registros relacionados para no dejar datos huérfanos.`))return;
    const result=await lifecycleDeleteService.deleteFromCurrentStage(sampleId,stage,{userId:'LOCAL_USER'});
    toast(`${result.code||code} eliminado de forma segura desde ${result.label}.`);
    await refresh();
  }catch(e){toast(e.message||String(e),true)}
}
document.addEventListener('click',e=>{const a=e.target.closest('[data-analysis]'),w=e.target.closest('[data-waiting]'),h=e.target.closest('[data-history]'),ed=e.target.closest('[data-edit]'),cc=e.target.closest('[data-client-catalog]'),mc=e.target.closest('[data-matrix-catalog]'),lo=e.target.closest('[data-lab-open]'),lsa=e.target.closest('[data-lab-save-analyst]'),lh=e.target.closest('[data-lab-history]'),sd=e.target.closest('[data-safe-delete-sample]');if(a)openAnalysis(a.dataset.analysis);if(w)openWaiting(w.dataset.waiting);if(h)openHistory(h.dataset.history);if(ed)openEdit(ed.dataset.edit);if(cc)editClientCatalog(cc.dataset.clientCatalog);if(mc)editMatrixCatalog(mc.dataset.matrixCatalog);if(lo)openLabEntry(lo.dataset.labOpen);if(lsa)saveLabAnalyst(lsa.dataset.labSaveAnalyst);if(lh)openLabHistory(lh.dataset.labHistory);if(sd)safeDeleteSample(sd.dataset.safeDeleteSample,sd.dataset.safeDeleteStage)});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')$('sampleForm').requestSubmit();if(e.altKey&&e.key.toLowerCase()==='n'){e.preventDefault();showView('register');clearForm()}if(e.altKey&&e.key.toLowerCase()==='r'){e.preventDefault();showView('register');repeatLast()}});
document.addEventListener('pep:financial-lock',()=>{showView('executiveDashboard');toast('Módulos financieros bloqueados.');});
async function refreshOutboxIndicator(){try{await outboxRepository.cleanupConfirmed();if($('outboxCount'))$('outboxCount').textContent=String(await outboxRepository.pendingCount())}catch(e){console.warn('No se pudo refrescar contador Outbox',e)}}
eventBus.on('outbox:changed',()=>refreshOutboxIndicator());
eventBus.on('sync:ack',()=>refreshOutboxIndicator());

async function initializeAuthenticatedERP({alreadyInitialized=false}={}){
  const perfToken=performanceCoordinator.start(alreadyInitialized?'runtime:restore':'runtime:first-auth');
  if(alreadyInitialized){
    if(liveSyncManager)await liveSyncManager.restoreConfigured().catch(e=>toast(`Live Sync: ${e.message||e}`,true));
    permissionEnforcement?.apply?.();
    performanceCoordinator.end(perfToken);performanceCoordinator.renderPanel();
    return;
  }
  await service.ensureCatalogs();
  reportsUI.init();billingUI.init();receivablesUI.init();trackingUI.init();dashboardUI.init();
  await syncFoundationUI.init();syncFoundationUI.onCleanup=async()=>{await refresh()};
  await securityFoundationUI.init();
  await authenticationInfrastructureUI.init();
  loginUI.onStatusChange=async()=>{await securityFoundationUI.refresh();await authenticationInfrastructureUI.refresh();};
  await loginUI.init();await claimsRolesUI.init();await customClaimsManagerUI.init();await enterpriseUserManagerUI.init();dynamicPermissionUI.init();await firestoreRulesValidationUI.init();
  permissionEnforcement=new PermissionUIEnforcer({toast});permissionEnforcement.init();

  liveSyncManager=getLiveSyncManager(syncManager,{onRemoteApplied:async()=>{await refresh()}});
  await liveSyncManager.init({restore:false});

  // V5.0.0-A1.1 — Baseline & Outbox Reconciliation: después de Login/Claims y antes de Dashboard/Live Sync.
  const authenticatedSession=securityManager.sessions.current();
  if(authenticatedSession?.authenticated&&authenticatedSession?.uid&&authenticatedSession?.role&&authenticatedSession.role!=='LOCAL_LEGACY'){
    try{await cloudReconciliationManager.runAfterLogin();}
    catch(e){toast(`Reconciliación: ${e.message||e}`,true);throw e}
  }

  globalSyncHealthUI=new GlobalSyncHealthUI(syncManager,{liveController:liveSyncManager});await globalSyncHealthUI.init();
  await outboxInspector.init();await conflictReviewCenter.init();
  syncFoundationUI.onBootstrap=async()=>{await refresh();if(securityManager.sessions.isAuthenticated())await liveSyncManager.activateAll({manual:false});await refresh()};
  await financialSecurity.init();await refresh();clearForm();
  // V5.0.0-A1.2 — New Client Live Sync Auto-Start Fix:
  // después de Login + reconciliación, una PC/navegador nuevo no debe depender
  // de preferencias antiguas de localStorage. Activa automáticamente todos los
  // dominios que el rol autenticado puede leer; activateAll() persiste luego
  // esas preferencias para futuras restauraciones de sesión.
  await liveSyncManager.activateAll({manual:false}).catch(e=>toast(`Live Sync: ${e.message||e}`,true));
  // V5.0.0-STABLE — capa de resiliencia alrededor del motor congelado.
  syncResilienceManager=new SyncResilienceManager(syncManager,{liveController:liveSyncManager,onRecovered:async()=>{await refresh();await globalSyncHealthUI?.refresh?.().catch(()=>{})}});
  await syncResilienceManager.init();
  window.pepSyncResilienceManager=syncResilienceManager;
  await globalSyncHealthUI?.refresh?.().catch(()=>{});
  permissionEnforcement.apply();
  performanceCoordinator.end(perfToken);performanceCoordinator.renderPanel();
}
async function lockAuthenticatedERP(){
  if(liveSyncManager)await liveSyncManager.stopAll({manual:false}).catch(()=>{});
}

initEnterpriseTableTools();

const startupManager=new StartupManager({
  openDatabase:openDB,
  securityManager,
  createSessionGate:({onAuthenticated,onLocked})=>new EnterpriseSessionGate({securityManager,toast,onAuthenticated,onLocked}),
  initializeAuthenticatedERP,
  lockAuthenticatedERP,
  onReady:async status=>{
    window.pepEnterpriseSessionGate=startupManager.sessionGate;
    window.pepStartupManager=startupManager;
    if(status.sessionUnlocked)toast('PEP V5.0.0-STABLE listo · Multi-PC Enterprise');
  },
  onError:async error=>{
    if($('dbStatus'))$('dbStatus').textContent='ERROR';
    toast(`Error de arranque: ${error.message||error}`,true);
  }
});
window.pepStartupManager=startupManager;
startupManager.boot().catch(()=>{});;
