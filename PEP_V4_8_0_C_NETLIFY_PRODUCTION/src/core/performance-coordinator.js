const now=()=>globalThis.performance?.now?.()??Date.now();

class PerformanceCoordinator{
  constructor(){
    this.metrics=new Map();
    this.idleJobs=new Map();
    this.marks=new Map();
  }
  start(name){return {name,at:now()}}
  end(token){
    if(!token?.name)return 0;
    const ms=Math.max(0,now()-token.at);
    const prev=this.metrics.get(token.name)||{count:0,total:0,last:0,max:0};
    prev.count+=1;prev.total+=ms;prev.last=ms;prev.max=Math.max(prev.max,ms);
    this.metrics.set(token.name,prev);return ms;
  }
  mark(name){this.marks.set(name,Date.now())}
  scheduleIdle(key,fn,{timeout=900}={}){
    if(this.idleJobs.has(key))return this.idleJobs.get(key);
    let resolveJob;
    const p=new Promise(r=>resolveJob=r);this.idleJobs.set(key,p);
    const run=async()=>{try{await fn()}finally{this.idleJobs.delete(key);resolveJob()}};
    if('requestIdleCallback' in globalThis)requestIdleCallback(()=>run(),{timeout});
    else setTimeout(run,0);
    return p;
  }
  snapshot(){
    const metrics={};for(const [k,v] of this.metrics)metrics[k]={...v,avg:v.count?v.total/v.count:0};
    const memory=globalThis.performance?.memory?{
      usedJSHeapSize:globalThis.performance.memory.usedJSHeapSize,
      totalJSHeapSize:globalThis.performance.memory.totalJSHeapSize
    }:null;
    return {metrics,memory,idleJobs:this.idleJobs.size,marks:Object.fromEntries(this.marks)};
  }
  renderPanel(){
    const host=document.getElementById('performanceMetricsBody');if(!host)return;
    const snap=this.snapshot();
    const names=['runtime:first-auth','runtime:restore','refresh:core','module:dashboard','module:reports','module:billing','module:receivables','module:tracking'];
    const rows=names.map(name=>{const m=snap.metrics[name];return `<tr><td><b>${name}</b></td><td>${m?m.last.toFixed(1)+' ms':'—'}</td><td>${m?m.avg.toFixed(1)+' ms':'—'}</td><td>${m?m.max.toFixed(1)+' ms':'—'}</td><td>${m?.count||0}</td></tr>`}).join('');
    host.innerHTML=rows;
    const idle=document.getElementById('performanceIdleJobs');if(idle)idle.textContent=String(snap.idleJobs);
    const mem=document.getElementById('performanceMemory');if(mem)mem.textContent=snap.memory?`${(snap.memory.usedJSHeapSize/1048576).toFixed(1)} MB`:'No disponible';
  }
}
export const performanceCoordinator=new PerformanceCoordinator();
