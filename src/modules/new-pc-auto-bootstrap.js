import {getAll} from '../data/database.js';
import {STORES} from '../data/schema.js';
import {SYNC_DOMAINS} from '../sync/sync-constants.js';
import {InitialCloudBootstrapService} from './initial-cloud-bootstrap.js';

const CORE_DOMAINS=Object.freeze(['SAMPLES','LABORATORY','REPORTS','BILLING','RECEIVABLES']);
const $=id=>document.getElementById(id);

export class NewPcAutoBootstrap{
  constructor(adapter){
    this.adapter=adapter;
    this.service=new InitialCloudBootstrapService(adapter);
    this.running=false;
  }
  async localCounts(){
    const out={};
    for(const d of SYNC_DOMAINS)out[d.id]=(await getAll(STORES[d.store])).length;
    return out;
  }
  async shouldRun(){
    const state=await this.service.status().catch(()=>null);
    if(state?.status==='COMPLETE')return {run:false,reason:'ALREADY_COMPLETE',state};
    const counts=await this.localCounts();
    const coreTotal=CORE_DOMAINS.reduce((n,id)=>n+Number(counts[id]||0),0);
    if(coreTotal>0)return {run:false,reason:'LOCAL_DATA_PRESENT',counts};
    return {run:true,reason:'NEW_EMPTY_DEVICE',counts};
  }
  show(title='Preparando esta computadora…',detail='Verificando datos disponibles en Firebase.'){
    const root=$('newPcBootstrapGate');if(!root)return;
    root.classList.add('show');root.setAttribute('aria-hidden','false');
    if($('newPcBootstrapTitle'))$('newPcBootstrapTitle').textContent=title;
    if($('newPcBootstrapDetail'))$('newPcBootstrapDetail').textContent=detail;
    this.progress(2,'Conectando con Firebase…');
  }
  hide(){const root=$('newPcBootstrapGate');if(root){root.classList.remove('show');root.setAttribute('aria-hidden','true')}}
  progress(pct,text){
    const safe=Math.max(0,Math.min(100,Number(pct||0)));
    if($('newPcBootstrapBar'))$('newPcBootstrapBar').style.width=`${safe}%`;
    if($('newPcBootstrapPercent'))$('newPcBootstrapPercent').textContent=`${Math.round(safe)}%`;
    if($('newPcBootstrapDetail')&&text)$('newPcBootstrapDetail').textContent=text;
  }
  async runIfNeeded(){
    if(this.running)return {ok:false,skipped:true,reason:'ALREADY_RUNNING'};
    const decision=await this.shouldRun();
    if(!decision.run)return {ok:true,skipped:true,...decision};
    this.running=true;this.show();
    try{
      this.progress(5,'Comprobando fotografía maestra en Firebase…');
      const pf=await this.service.preflight();
      if(!pf.remoteTotal){this.hide();return {ok:true,skipped:true,reason:'REMOTE_EMPTY'}}
      this.progress(8,`Firebase contiene ${pf.remoteTotal} registro(s). Iniciando descarga…`);
      const result=await this.service.run({batchSize:250,onProgress:p=>{
        const pct=p.globalTotal?8+Math.round((p.globalDone/p.globalTotal)*84):8;
        this.progress(pct,`${p.label||p.domain}: ${p.done||0} de ${p.total||0}`);
      }});
      this.progress(94,'Guardando y verificando IndexedDB…');
      await new Promise(r=>setTimeout(r,120));
      this.progress(100,'Sincronización inicial completada. Abriendo ERP…');
      await new Promise(r=>setTimeout(r,550));
      this.hide();
      return {ok:true,bootstrapped:true,result};
    }catch(error){
      const msg=String(error?.message||error);
      if($('newPcBootstrapTitle'))$('newPcBootstrapTitle').textContent='No se pudo completar la sincronización inicial';
      this.progress(0,msg);
      const retry=$('newPcBootstrapRetry');if(retry)retry.style.display='inline-flex';
      const cont=$('newPcBootstrapContinue');if(cont)cont.style.display='inline-flex';
      return {ok:false,error};
    }finally{this.running=false}
  }
  bindRetry(onComplete){
    const retry=$('newPcBootstrapRetry'),cont=$('newPcBootstrapContinue');
    if(retry&&!retry.dataset.bound){retry.dataset.bound='1';retry.addEventListener('click',async()=>{
      retry.style.display='none';if(cont)cont.style.display='none';
      const r=await this.runIfNeeded();if(r.ok&&onComplete)await onComplete(r);
    })}
    if(cont&&!cont.dataset.bound){cont.dataset.bound='1';cont.addEventListener('click',()=>this.hide())}
  }
}
