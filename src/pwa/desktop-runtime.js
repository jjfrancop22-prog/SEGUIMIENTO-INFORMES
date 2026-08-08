let deferredInstallPrompt=null;
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
const byId=id=>document.getElementById(id);
function setInstallVisible(show){for(const id of ['pepInstallApp','pepInstallAppHeader']){const el=byId(id);if(el)el.style.display=show&&!isStandalone()?'inline-flex':'none'}}
async function installApp(){
  if(isStandalone())return;
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();try{await deferredInstallPrompt.userChoice}catch{}deferredInstallPrompt=null;setInstallVisible(false);return}
  const msg=/Mac/i.test(navigator.platform||'')?'Para instalar PEP Enterprise: en Chrome/Edge use el icono Instalar de la barra de direcciones; en Safari use Archivo → Añadir al Dock.':'Para instalar PEP Enterprise, use el icono Instalar aplicación de Chrome o Edge en la barra de direcciones.';alert(msg);
}
function showUpdate(registration){
  if(document.getElementById('pepPwaUpdate'))return;
  const bar=document.createElement('div');bar.id='pepPwaUpdate';bar.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:999999;background:#173c29;color:#fff;padding:11px 13px;border-radius:11px;box-shadow:0 12px 34px #0004;display:flex;gap:10px;align-items:center;font:600 12px system-ui';
  bar.innerHTML='<span>Nueva versión de PEP Enterprise disponible.</span><button type="button" style="border:0;border-radius:8px;padding:7px 10px;font-weight:800;cursor:pointer">Actualizar ahora</button>';
  bar.querySelector('button').addEventListener('click',()=>registration.waiting?.postMessage({type:'SKIP_WAITING'}));document.body.appendChild(bar);
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;setInstallVisible(true)});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;setInstallVisible(false)});
window.addEventListener('DOMContentLoaded',()=>{byId('pepInstallApp')?.addEventListener('click',installApp);byId('pepInstallAppHeader')?.addEventListener('click',installApp);setInstallVisible(false)});
if('serviceWorker' in navigator){
  let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;location.reload()});
  window.addEventListener('load',async()=>{
    try{
      const reg=await navigator.serviceWorker.register('/service-worker.js',{updateViaCache:'none'});
      if(reg.waiting)showUpdate(reg);
      reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate(reg)})});
      setInterval(()=>reg.update().catch(()=>{}),30*60*1000);
    }catch{}
  });
}
