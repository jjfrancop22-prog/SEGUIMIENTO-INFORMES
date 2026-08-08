import {SYNC_DOMAINS} from '../sync/sync-constants.js';
import {VERSION_METADATA} from '../core/version-metadata.js';
import {runSyncFoundationSelfTests} from '../sync/sync-foundation-tests.js';
import {cloudFoundationCleanupService} from './cloud-foundation-cleanup.js';
import {InitialCloudSeedService} from './initial-cloud-seed.js';
import {InitialCloudBootstrapService} from './initial-cloud-bootstrap.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const cursorText=v=>!v?'—':typeof v==='object'?`${new Date(Number(v.timestampMillis||0)).toLocaleString('es-EC')} · ${String(v.docId||'').slice(0,10)}`:String(v);
export class SyncFoundationUI{
  constructor(manager){this.manager=manager;this.$=id=>document.getElementById(id);this.onCleanup=null;this.onBootstrap=null;this.seedService=new InitialCloudSeedService(manager.adapter);this.bootstrapService=new InitialCloudBootstrapService(manager.adapter);this.seedRunning=false;this.seedPreflightOk=false;this.bootstrapPreflightOk=false}
  async init(){
    this.$('syncRefresh')?.addEventListener('click',()=>this.refresh());this.$('syncSelfTest')?.addEventListener('click',()=>this.selfTest());this.$('syncRunLocal')?.addEventListener('click',()=>this.localCheck());
    this.$('cloudBaselineCleanup')?.addEventListener('click',()=>this.cleanup());this.$('cloudBaselineArchive')?.addEventListener('click',()=>this.archive());
    this.$('firebaseLoadConfig')?.addEventListener('click',()=>this.loadFirebaseForm());this.$('firebaseSaveConfig')?.addEventListener('click',()=>this.saveFirebaseConfig());
    this.$('firebaseConnect')?.addEventListener('click',()=>this.connectFirebase());this.$('firebaseDisconnect')?.addEventListener('click',()=>this.disconnectFirebase());
    this.$('firebaseTestRead')?.addEventListener('click',()=>this.testFirebase(false));this.$('firebaseTestWrite')?.addEventListener('click',()=>this.testFirebase(true));
    this.$('cloudSeedPreflight')?.addEventListener('click',()=>this.seedPreflight());this.$('cloudSeedStart')?.addEventListener('click',()=>this.startSeed());this.$('cloudSeedVerify')?.addEventListener('click',()=>this.verifySeed());this.$('cloudBootstrapStart')?.addEventListener('click',()=>this.startBootstrap());
    this.loadFirebaseForm();
    await this.restoreFirebaseConnection();
    const seedStart=this.$('cloudSeedStart');if(seedStart){seedStart.disabled=true;seedStart.title='Ejecute primero 1. Preflight'}
  }

  async restoreFirebaseConnection(){
    try{
      const a=this.manager.adapter;
      if(typeof a.restoreConnection!=='function')return;
      const h=await a.restoreConnection();
      if(h?.connected){
        this.renderFirebaseInfo(`<b>✅ Firebase Adapter reconectado automáticamente.</b> Proyecto: ${esc(h.projectId)} · Namespace: ${esc(h.namespace)}. La sesión mantiene una única conexión activa.`);
        await this.refresh();
      }else{
        await this.renderFirebaseInfo();
      }
    }catch(e){
      this.renderFirebaseInfo(`<b>No se pudo restaurar la conexión:</b> ${esc(e.message||e)}`,true);
    }
  }

  firebaseForm(){return {apiKey:this.$('fbApiKey')?.value||'',authDomain:this.$('fbAuthDomain')?.value||'',projectId:this.$('fbProjectId')?.value||'',appId:this.$('fbAppId')?.value||'',messagingSenderId:this.$('fbSenderId')?.value||'',storageBucket:this.$('fbStorageBucket')?.value||'',namespace:this.$('fbNamespace')?.value||'pep-v4'}}
  loadFirebaseForm(){const a=this.manager.adapter,c=a.getConfig?.()||{};if(this.$('fbApiKey'))this.$('fbApiKey').value=c.apiKey||'';if(this.$('fbAuthDomain'))this.$('fbAuthDomain').value=c.authDomain||'';if(this.$('fbProjectId'))this.$('fbProjectId').value=c.projectId||'';if(this.$('fbAppId'))this.$('fbAppId').value=c.appId||'';if(this.$('fbSenderId'))this.$('fbSenderId').value=c.messagingSenderId||'';if(this.$('fbStorageBucket'))this.$('fbStorageBucket').value=c.storageBucket||'';if(this.$('fbNamespace'))this.$('fbNamespace').value=c.namespace||'pep-v4';this.renderFirebaseInfo()}
  saveFirebaseConfig(){try{const c=this.manager.adapter.setConfig?.(this.firebaseForm(),{persist:true});this.renderFirebaseInfo(`<b>✅ Configuración guardada localmente.</b> Proyecto: ${esc(c?.projectId||'sin Project ID')}. No se subió ningún dato.`)}catch(e){this.renderFirebaseInfo(`<b>Error al guardar:</b> ${esc(e.message||e)}`,true)}}
  async connectFirebase(){const btn=this.$('firebaseConnect');if(btn){btn.disabled=true;btn.textContent='Conectando…'}try{this.manager.adapter.setConfig?.(this.firebaseForm(),{persist:true});const r=await this.manager.connect();await this.renderFirebaseInfo(`<b>✅ Firebase Adapter conectado.</b> Proyecto: ${esc(r.projectId)} · Namespace: ${esc(r.namespace)}.`);await this.refresh()}catch(e){this.renderFirebaseInfo(`<b>No se pudo conectar:</b> ${esc(e.message||e)}`,true);await this.refresh()}finally{this.syncConnectionControls(!!this.manager.adapter.isConnected?.())}}
  async disconnectFirebase(){try{await this.manager.disconnect();await this.renderFirebaseInfo('<b>Firebase Adapter desconectado.</b> IndexedDB sigue operativo y no se perdió ningún dato.');await this.refresh()}catch(e){this.renderFirebaseInfo(`<b>Error al desconectar:</b> ${esc(e.message||e)}`,true)}}
  async testFirebase(write){const btn=this.$(write?'firebaseTestWrite':'firebaseTestRead');if(btn){btn.disabled=true;btn.textContent='Probando…'}try{const a=this.manager.adapter;if(!a.isConnected?.())throw new Error('Firebase Adapter no conectado. Pulse Conectar Firebase primero.');const r=await a.testConnection?.({write});if(!r)throw new Error('El Adapter no implementa diagnóstico.');if(r.ok)this.renderFirebaseInfo(`<b>✅ Diagnóstico Firebase correcto.</b> Proyecto: ${esc(r.projectId)} · ${write?'Lectura y escritura temporal confirmadas; el documento diagnóstico fue eliminado.':'Lectura permitida.'} · Conexión reutilizada y permanece activa.`);else this.renderFirebaseInfo(`<b>⚠️ Firebase respondió, pero Firestore rechazó la prueba.</b> ${esc(r.error||'Revise reglas/permisos.')}`,true)}catch(e){this.renderFirebaseInfo(`<b>Error de diagnóstico:</b> ${esc(e.message||e)}`,true)}finally{if(btn){btn.disabled=false;btn.textContent=write?'Probar lectura + escritura diagnóstico':'Probar lectura'}}}
  syncConnectionControls(connected){
    const connect=this.$('firebaseConnect'),disconnect=this.$('firebaseDisconnect');
    if(connect){connect.disabled=!!connected;connect.textContent=connected?'✅ Conectado':'Conectar Firebase';connect.classList.toggle('secondary',!!connected)}
    if(disconnect){disconnect.disabled=!connected}
  }
  async renderFirebaseInfo(html=null,error=false){
    const box=this.$('firebaseAdapterInfo');if(!box)return;
    const a=this.manager.adapter;
    let connected=!!a.isConnected?.();
    // Si la sesión había solicitado mantener Firebase conectado, restaura la MISMA instancia
    // antes de dibujar el estado. No crea un adapter alterno ni toca datos.
    if(!connected&&a.desiredConnected&&typeof a.restoreConnection==='function'){
      try{await a.restoreConnection()}catch{}
      connected=!!a.isConnected?.();
    }
    const h=await a.health();
    connected=!!a.isConnected?.();
    this.syncConnectionControls(connected);
    if(html){box.innerHTML=`<div class="notice ${error?'warn':''}">${html}${connected?' · <b>Conectado: SÍ</b>':''}</div>`;return}
    const mode=connected?'FIREBASE_CONNECTED':(h.configured?'FIREBASE_CONFIGURED':'FIREBASE_UNCONFIGURED');
    box.innerHTML=`<div class="notice ${h.configured?'':'warn'}"><b>Estado:</b> ${esc(mode)} · <b>Proyecto:</b> ${esc(h.projectId||'—')} · <b>Namespace:</b> ${esc(h.namespace||'—')} · <b>Conectado:</b> ${connected?'SÍ':'NO'}${h.lastError?` · <b>Último error:</b> ${esc(h.lastError)}`:''}</div>`
  }
  async refresh(){
    const s=await this.manager.status(),health=s.health||{};this.$('syncAdapterName').textContent=health.provider||'—';this.$('syncMode').textContent=health.mode||'—';this.$('syncProtocol').textContent=String(VERSION_METADATA.syncProtocolVersion);this.$('syncEntitySchema').textContent=String(VERSION_METADATA.entitySyncSchemaVersion);
    this.$('syncDomainRows').innerHTML=s.domains.map(d=>`<tr><td><b>${esc(SYNC_DOMAINS.find(x=>x.id===d.id)?.label||d.id)}</b><div class="muted mono">${d.id}</div></td><td><span class="badge ${d.status==='ERROR'?'red':d.status==='SYNCED'?'green':'blue'}">${esc(d.status)}</span></td><td>${d.pending}</td><td>${esc(cursorText(d.cursor))}</td><td>${d.lastSuccessAt?new Date(d.lastSuccessAt).toLocaleString('es-EC'):'—'}</td><td>${d.lastError?`<span class="badge red">${esc(d.lastError)}</span>`:'—'}</td></tr>`).join('');
    await this.refreshBaseline();await this.renderFirebaseInfo();await this.refreshSeed();return s;
  }
  async refreshBaseline(){const x=await cloudFoundationCleanupService.status();const b=x.baseline;this.$('baselineSamples').textContent=String(x.sampleCount);this.$('baselineOutbox').textContent=String(x.outboxPending);this.$('baselineAudit').textContent=String(x.auditCount);this.$('baselineStatus').textContent=b?.status==='VERIFIED_CLOUD_BASELINE'?'VERIFICADO':b?.status==='READY_FOR_INITIAL_CLOUD_SEED'?'READY':'PENDIENTE';this.$('baselineInfo').innerHTML=b?`<div class="notice"><b>✅ ${b.status==='VERIFIED_CLOUD_BASELINE'?'Baseline verificado':'Baseline creado'}:</b> ${esc(b.baselineId)} · ${new Date(b.verifiedAt||b.createdAt||Date.now()).toLocaleString('es-EC')} · Outbox histórico archivado/limpiado: ${b.outboxArchived??0}.</div>`:`<div class="notice warn"><b>Baseline pendiente.</b> Antes de Firebase conviene archivar y vaciar el Outbox histórico, conservar Audit y marcar la fotografía local actual como READY.</div>`;return x}
  async archive(){const r=await cloudFoundationCleanupService.archiveOutbox();this.$('baselineInfo').innerHTML=`<div class="notice"><b>Archivo generado:</b> ${r.count} eventos de Outbox histórico. No se modificó la base local.</div>`}
  async cleanup(){const st=await cloudFoundationCleanupService.status();if(st.baseline?.status==='READY_FOR_INITIAL_CLOUD_SEED'&&!confirm('Ya existe un Cloud Baseline. ¿Desea recrearlo y limpiar nuevamente el Outbox actual?'))return;if(!st.baseline&&!confirm(`Se archivarán y luego eliminarán ${st.outboxTotal} eventos históricos del Outbox. Audit se conservará completo y los ${st.sampleCount} registros de samples quedarán marcados READY/CLEAN. ¿Continuar?`))return;const btn=this.$('cloudBaselineCleanup');if(btn){btn.disabled=true;btn.textContent='Creando baseline…'}try{const r=await cloudFoundationCleanupService.createBaselineAndCleanup();await this.refresh();this.$('baselineInfo').innerHTML=`<div class="notice"><b>✅ CLOUD BASELINE LISTO.</b> Samples: ${r.after.sampleCount} · Outbox: ${r.after.outboxPending} · Audit: ${r.after.auditCount}. Ya está preparada la fotografía local para Initial Cloud Seed.</div>`;if(this.onCleanup)await this.onCleanup(r)}catch(e){this.$('baselineInfo').innerHTML=`<div class="notice warn"><b>Error:</b> ${esc(e.message||e)}</div>`}finally{if(btn){btn.disabled=false;btn.textContent='Crear baseline + limpiar Outbox'}}}
  seedBar(pct,text){const bar=this.$('cloudSeedProgressBar'),label=this.$('cloudSeedProgressText');if(bar)bar.style.width=`${Math.max(0,Math.min(100,pct))}%`;if(label)label.textContent=text||`${pct}%`}
  bootstrapBar(pct,text){const bar=this.$('cloudBootstrapProgressBar'),label=this.$('cloudBootstrapProgressText');if(bar)bar.style.width=`${Math.max(0,Math.min(100,pct))}%`;if(label)label.textContent=text||`${pct}%`}
  seedTable(rows=[]){const body=this.$('cloudSeedDomainRows');if(!body)return;body.innerHTML=rows.map(x=>`<tr><td><b>${esc(x.label||x.id)}</b><div class="muted mono">${esc(x.id)}</div></td><td>${x.local??0}</td><td>${x.remote??'—'}</td><td><span class="badge ${x.match===false?'red':x.match===true?'green':'blue'}">${x.status|| (x.match===true?'OK':x.match===false?'DIFERENTE':'PENDIENTE')}</span></td></tr>`).join('')}
  async refreshSeed(){const st=await this.seedService.status();const box=this.$('cloudSeedInfo');if(!box)return;const rows=SYNC_DOMAINS.map(d=>{const x=st.domains?.[d.id]||{};return {id:d.id,label:d.label,local:x.local??'—',remote:x.remoteAfter??x.remoteBefore??'—',status:x.status||'PENDIENTE'}});this.seedTable(rows);if(st.status==='COMPLETE'){this.seedBar(100,'100% · Seed verificado');box.innerHTML=`<div class="notice"><b>✅ INITIAL CLOUD SEED COMPLETO.</b> Baseline: ${esc(st.baselineId||'—')} · ${st.completedAt?new Date(st.completedAt).toLocaleString('es-EC'):''}. Los listeners siguen desactivados.</div>`}else if(st.status==='ERROR'){box.innerHTML=`<div class="notice warn"><b>⚠️ Seed interrumpido.</b> ${esc(st.lastError||'Puede reintentar; la operación es idempotente.')}</div>`}else if(st.status==='RUNNING'){box.innerHTML='<div class="notice warn"><b>Seed marcado RUNNING.</b> Si la pestaña se cerró, puede volver a iniciar; los documentos se escriben por ID y el proceso es reanudable/idempotente.</div>'}else{box.innerHTML='<div class="notice"><b>Seed aún no ejecutado.</b> Primero use Preflight. Esta operación no activa listeners.</div>'}}
  async seedPreflight(){
    const btn=this.$('cloudSeedPreflight'),seedBtn=this.$('cloudSeedStart'),bootBtn=this.$('cloudBootstrapStart');
    if(btn){btn.disabled=true;btn.textContent='Comprobando…'}if(seedBtn){seedBtn.disabled=true;seedBtn.style.display='none'}if(bootBtn){bootBtn.disabled=true;bootBtn.style.display='none'}
    this.seedPreflightOk=false;this.bootstrapPreflightOk=false;
    try{
      // Primero mirar la nube sin exigir baseline local. Esto permite reconocer una PC nueva.
      let bpf=null;try{bpf=await this.bootstrapService.preflight()}catch(e){if(!String(e.message||e).includes('Firebase está vacío'))throw e}
      if(bpf&&bpf.remoteTotal>0){
        const rows=SYNC_DOMAINS.map(d=>({id:d.id,label:d.label,local:bpf.localCounts[d.id]||0,remote:bpf.remoteCounts[d.id]||0,match:(bpf.localCounts[d.id]||0)===(bpf.remoteCounts[d.id]||0),status:(bpf.localCounts[d.id]||0)===(bpf.remoteCounts[d.id]||0)?'COINCIDE':'REMOTO CON DATOS'}));
        this.seedTable(rows);this.bootstrapPreflightOk=true;
        if(seedBtn){seedBtn.disabled=true;seedBtn.style.display='none';seedBtn.title='Firebase ya contiene datos: Seed bloqueado en esta PC'}
        if(bootBtn){bootBtn.disabled=false;bootBtn.style.display='inline-flex'}
        this.$('cloudSeedInfo').innerHTML=`<div class="notice warn"><b>☁️ FIREBASE YA CONTIENE LA BASE PEP.</b> Local: ${bpf.localTotal} · Remoto: ${bpf.remoteTotal}. <b>Initial Cloud Seed está bloqueado.</b> Esta computadora debe usar <b>Descargar desde Firebase (Bootstrap)</b>.</div>`;
        await this.renderFirebaseInfo();return;
      }
      // Nube vacía: flujo de la PC maestra / primer Seed.
      const r=await this.seedService.preflight();
      const rows=SYNC_DOMAINS.map(d=>({id:d.id,label:d.label,local:r.localCounts[d.id]||0,remote:r.remoteCounts[d.id]||0,match:(r.localCounts[d.id]||0)===(r.remoteCounts[d.id]||0),status:(r.remoteCounts[d.id]||0)===0?'VACÍO':'COINCIDE'}));
      this.seedTable(rows);this.seedPreflightOk=true;if(seedBtn){seedBtn.disabled=false;seedBtn.style.display='inline-flex';seedBtn.title='Preflight correcto: listo para Initial Cloud Seed'}if(bootBtn)bootBtn.style.display='none';
      await this.renderFirebaseInfo();this.$('cloudSeedInfo').innerHTML=`<div class="notice"><b>✅ PRE-FLIGHT CORRECTO.</b> Firebase está vacío · Local: ${Object.values(r.localCounts).reduce((a,b)=>a+b,0)} · Baseline: ${esc(r.baseline.baselineId)}. Listo para la primera subida.</div>`;
    }catch(e){if(seedBtn){seedBtn.disabled=true;seedBtn.style.display='none'}if(bootBtn){bootBtn.disabled=true;bootBtn.style.display='none'}this.$('cloudSeedInfo').innerHTML=`<div class="notice warn"><b>Preflight rechazado:</b> ${esc(e.message||e)}</div>`}
    finally{if(btn){btn.disabled=false;btn.textContent='1. Preflight'}}
  }
  async startSeed(){if(this.seedRunning)return;if(!this.seedPreflightOk){this.$('cloudSeedInfo').innerHTML='<div class="notice warn"><b>Preflight requerido:</b> ejecute primero 1. Preflight y confirme los conteos.</div>';return}let pf;try{pf=await this.seedService.preflight()}catch(e){this.$('cloudSeedInfo').innerHTML=`<div class="notice warn"><b>No se puede iniciar:</b> ${esc(e.message||e)}</div>`;return}const remoteTotal=Object.values(pf.remoteCounts).reduce((a,b)=>a+Number(b||0),0);const localTotal=Object.values(pf.localCounts).reduce((a,b)=>a+Number(b||0),0);const msg=`Se realizará el Initial Cloud Seed de ${localTotal} registros por lotes de 250.\n\nFirebase ya contiene ${remoteTotal} registros PEP. La operación usa el ID de cada entidad y puede reintentarse sin duplicar documentos.\n\nNO se activarán listeners. ¿Continuar?`;if(!confirm(msg))return;const btn=this.$('cloudSeedStart');this.seedRunning=true;if(btn){btn.disabled=true;btn.textContent='Subiendo…'}this.seedBar(0,'Preparando…');try{const r=await this.seedService.run({batchSize:250,onProgress:p=>{const pct=p.globalTotal?Math.round((p.globalDone/p.globalTotal)*100):0;this.seedBar(pct,`${pct}% · ${p.label||p.domain} · ${p.domainDone||p.done||0}/${p.domainTotal||p.total||0}`)}});await this.refresh();this.$('cloudSeedInfo').innerHTML=`<div class="notice"><b>✅ INITIAL CLOUD SEED VERIFICADO.</b> Firestore coincide con IndexedDB en todos los dominios. ${r.alreadyComplete?'El Seed ya estaba completo; no fue necesario repetirlo.':''}</div>`}catch(e){this.$('cloudSeedInfo').innerHTML=`<div class="notice warn"><b>Seed detenido:</b> ${esc(e.message||e)}. Puede reintentar; no se duplican documentos porque cada entidad usa su ID estable.</div>`;await this.refreshSeed()}finally{this.seedRunning=false;if(btn){btn.disabled=false;btn.textContent='2. Iniciar Cloud Seed'}}}
  async startBootstrap(){
    if(!this.bootstrapPreflightOk)return;
    const btn=this.$('cloudBootstrapStart');if(btn){btn.disabled=true;btn.textContent='Descargando…'}this.bootstrapBar(0,'Preparando descarga…');
    try{
      const pf=await this.bootstrapService.preflight();
      if(!confirm(`Esta computadora descargará ${pf.remoteTotal} registros desde Firebase y reemplazará únicamente los stores cloud-domain locales.\n\nNo se subirá ningún dato a Firebase. Los UUID/ID se conservarán.\n\n¿Continuar?`))return;
      const r=await this.bootstrapService.run({batchSize:250,onProgress:p=>{const pct=p.globalTotal?Math.round((p.globalDone/p.globalTotal)*100):0;this.bootstrapBar(pct,`${pct}% · ${p.label||p.domain} · ${p.done||0}/${p.total||0}`)}});
      this.bootstrapBar(100,'100% · Bootstrap verificado');
      this.seedTable(SYNC_DOMAINS.map(d=>({id:d.id,label:d.label,local:r.localCounts[d.id],remote:r.remoteCounts[d.id],match:r.localCounts[d.id]===r.remoteCounts[d.id],status:'BOOTSTRAP OK'})));
      this.$('cloudBootstrapInfo').innerHTML='<div class="notice"><b>✅ CLOUD BOOTSTRAP COMPLETO.</b> IndexedDB coincide con Firebase. No se ejecutó Cloud Seed desde esta PC. Activando Samples Live Sync…</div>';
      if(this.onBootstrap)await this.onBootstrap(r);
      await this.refresh();
      this.$('cloudBootstrapInfo').innerHTML='<div class="notice"><b>✅ PC NUEVA PREPARADA.</b> Local = Firebase y Samples Live Sync quedó activado automáticamente.</div>';
    }catch(e){this.$('cloudBootstrapInfo').innerHTML=`<div class="notice warn"><b>Bootstrap detenido:</b> ${esc(e.message||e)}</div>`}
    finally{if(btn){btn.disabled=false;btn.textContent='⬇ Descargar desde Firebase (Bootstrap)'}}
  }
  async verifySeed(){const btn=this.$('cloudSeedVerify');if(btn){btn.disabled=true;btn.textContent='Verificando…'}try{const r=await this.seedService.verify();this.seedTable(r.domains.map(x=>({...x,status:x.match?'OK':'DIFERENTE'})));this.$('cloudSeedInfo').innerHTML=`<div class="notice ${r.ok?'':'warn'}"><b>${r.ok?'✅ VERIFICACIÓN CORRECTA':'⚠️ CONTEOS DIFERENTES'}.</b> ${r.domains.map(x=>`${x.id}: ${x.local}/${x.remote}`).join(' · ')}</div>`}catch(e){this.$('cloudSeedInfo').innerHTML=`<div class="notice warn"><b>Error de verificación:</b> ${esc(e.message||e)}</div>`}finally{if(btn){btn.disabled=false;btn.textContent='3. Verificar Firebase'}}}
  async localCheck(){const s=await this.refresh();const box=this.$('syncTestResults');box.innerHTML=`<div class="notice"><b>Diagnóstico local:</b> ${s.domains.length} runtimes independientes inicializados. Adapter: <b>${esc(s.health.provider)}</b>. Modo: <b>${esc(s.health.mode)}</b>. No se realizó ninguna escritura cloud.</div>`}
  async selfTest(){const box=this.$('syncTestResults');box.innerHTML='<div class="notice">Ejecutando pruebas en memoria…</div>';const r=await runSyncFoundationSelfTests();box.innerHTML=`<div class="notice ${r.ok?'':'warn'}"><b>${r.ok?'✅ PRUEBAS SUPERADAS':'⚠️ REVISAR PRUEBAS'}</b> · ${r.passed}/${r.total}</div><div class="table-wrap"><table><thead><tr><th>Prueba</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>${r.tests.map(t=>`<tr><td>${esc(t.name)}</td><td><span class="badge ${t.ok?'green':'red'}">${t.ok?'OK':'ERROR'}</span></td><td class="mono">${esc(t.detail||'—')}</td></tr>`).join('')}</tbody></table></div>`}
}
