import {FirestoreRulesValidator,RULES_VALIDATION_VERSION} from '../security/firestore-rules-validator.js';
import {firebaseCloudAdapterSingleton} from '../sync/firebase-cloud-adapter.js';
const $=id=>document.getElementById(id);const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function download(name,text,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0)}
function badge(ok,yes='PASS',no='FAIL'){return `<span class="badge ${ok?'green':'red'}">${ok?yes:no}</span>`}
export class FirestoreRulesValidationUI{
  constructor(){this.validator=new FirestoreRulesValidator();this.result=null}
  async init(){
    $('rulesValidate')?.addEventListener('click',()=>this.validate());
    $('rulesDownload')?.addEventListener('click',()=>this.downloadRules());
    $('rulesExport')?.addEventListener('click',()=>this.exportMatrix());
    await this.refresh();
  }
  async refresh(){
    const cfg=firebaseCloudAdapterSingleton.getConfig?.()||{};this.validator.setNamespace(cfg.namespace||'pep-v4');
    if($('rulesNamespace'))$('rulesNamespace').textContent=this.validator.namespace;
    if($('rulesVersion'))$('rulesVersion').textContent=RULES_VALIDATION_VERSION;
    if($('rulesPreview'))$('rulesPreview').textContent=this.validator.candidateRules();
    if(this.result)this.render(this.result);else this.renderEmpty();
  }
  async validate(){this.result=this.validator.run();this.render(this.result)}
  renderEmpty(){
    if($('rulesStatus'))$('rulesStatus').textContent='PENDIENTE';if($('rulesPassed'))$('rulesPassed').textContent='0';if($('rulesFailed'))$('rulesFailed').textContent='0';if($('rulesCoverage'))$('rulesCoverage').textContent='7 dominios';
    if($('rulesChecks'))$('rulesChecks').innerHTML='<div class="notice"><b>Validación no ejecutada.</b> Pulse “Ejecutar validación local”. Esta operación no consulta ni modifica Firestore.</div>';
    if($('rulesTestRows'))$('rulesTestRows').innerHTML='<tr><td colspan="7" class="muted">Sin resultados todavía.</td></tr>';
  }
  render(r){
    if($('rulesStatus'))$('rulesStatus').textContent=r.failed===0?'VALIDADO':'REVISAR';if($('rulesPassed'))$('rulesPassed').textContent=r.passed;if($('rulesFailed'))$('rulesFailed').textContent=r.failed;if($('rulesCoverage'))$('rulesCoverage').textContent='7 + 7 streams';
    if($('rulesChecks'))$('rulesChecks').innerHTML=r.checks.map(c=>`<div class="notice ${c.pass?'':'warn'}">${badge(c.pass)} <b>${esc(c.label)}</b></div>`).join('');
    const important=r.tests.filter(x=>x.role==='UNAUTHENTICATED'||x.role==='ADMINISTRADOR'||x.domain==='SYSTEM'||x.domain==='DIAGNOSTICS'||(!x.actual&&x.authenticated)).slice(0,120);
    if($('rulesTestRows'))$('rulesTestRows').innerHTML=important.map(x=>`<tr><td>${esc(x.role)}</td><td>${esc(x.domain)}</td><td>${esc(x.operation)}</td><td class="mono">${esc(x.permission)}</td><td>${x.expected?'ALLOW':'DENY'}</td><td>${x.actual?'ALLOW':'DENY'}</td><td>${badge(x.pass)}</td></tr>`).join('');
    if($('rulesInfo'))$('rulesInfo').innerHTML=`<div class="notice ${r.failed?'warn':''}"><b>${r.failed?'REVISAR':'VALIDACIÓN LOCAL CORRECTA'}.</b> ${r.passed}/${r.total} escenarios coinciden con la matriz de permisos. <b>Paquete V4.7.4 listo; el despliegue se realiza de forma controlada con Firebase CLI.</b></div>`;
  }
  downloadRules(){download(`firestore_${RULES_VALIDATION_VERSION.replace(/\./g,'_')}_PRODUCTION.rules`,this.validator.candidateRules())}
  exportMatrix(){const r=this.result||this.validator.run();download(`PEP_${RULES_VALIDATION_VERSION.replace(/\./g,'_')}_RULES_VALIDATION.json`,JSON.stringify(r,null,2),'application/json')}
}
export const firestoreRulesValidationUI=new FirestoreRulesValidationUI();
