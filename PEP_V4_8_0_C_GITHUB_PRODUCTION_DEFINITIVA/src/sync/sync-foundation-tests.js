import {MemoryCloudAdapter} from './memory-cloud-adapter.js';
export async function runSyncFoundationSelfTests(){
  const tests=[];const add=(name,ok,detail='')=>tests.push({name,ok,detail});
  try{
    const cloud=new MemoryCloudAdapter();await cloud.connect();
    const c1={id:'t1',domain:'SAMPLES',operation:'UPSERT',entityType:'Sample',entityId:'A',revision:1,payload:{id:'A',revision:1,updatedAt:'2026-08-07T12:00:00.000Z',code:'100'}};
    const p1=await cloud.push(c1);add('Contrato push acepta revisión inicial',p1.accepted===true,JSON.stringify(p1));
    const stale=await cloud.push({...c1,id:'t2',revision:0,payload:{...c1.payload,revision:0}});add('Protección de revisión antigua',stale.accepted===false&&stale.reason==='STALE_REVISION',JSON.stringify(stale));
    const page=await cloud.pullSince('SAMPLES',null);add('Pull incremental por dominio',page.changes.length===1&&page.changes[0].entityId==='A',`changes=${page.changes.length}`);
    const isolated=await cloud.pullSince('REPORTS',null);add('Aislamiento entre dominios',isolated.changes.length===0,`REPORTS=${isolated.changes.length}`);
    const failing=new MemoryCloudAdapter({failDomains:['REPORTS']});await failing.connect();let reportsFailed=false;try{await failing.push({...c1,domain:'REPORTS'})}catch{reportsFailed=true}const samplesOk=(await failing.push({...c1,id:'t3',entityId:'B'})).accepted===true;add('Fallo de REPORTS no bloquea SAMPLES',reportsFailed&&samplesOk,`reportsFailed=${reportsFailed}; samplesOk=${samplesOk}`);
    await cloud.disconnect();add('Connect / disconnect del contrato',true,'OK');
  }catch(e){add('Suite general',false,String(e))}
  return {ok:tests.every(x=>x.ok),tests,passed:tests.filter(x=>x.ok).length,total:tests.length,ranAt:new Date().toISOString()};
}
