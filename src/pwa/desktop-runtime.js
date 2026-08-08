let deferredInstallPrompt=null;
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
const byId=id=>document.getElementById(id);
function setInstallVisible(show){
  for(const id of ['pepInstallApp','pepInstallAppHeader']){
    const el=byId(id); if(el) el.style.display=show&&!isStandalone()?'inline-flex':'none';
  }
}
async function installApp(){
  if(isStandalone())return;
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    try{await deferredInstallPrompt.userChoice;}catch{}
    deferredInstallPrompt=null; setInstallVisible(false); return;
  }
  const msg=/Mac/i.test(navigator.platform||'')
    ? 'Para instalar PEP Enterprise: en Chrome/Edge use el icono Instalar de la barra de direcciones; en Safari use Archivo → Añadir al Dock.'
    : 'Para instalar PEP Enterprise, use el icono Instalar aplicación de Chrome o Edge en la barra de direcciones.';
  alert(msg);
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;setInstallVisible(true);});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;setInstallVisible(false);});
window.addEventListener('DOMContentLoaded',()=>{
  byId('pepInstallApp')?.addEventListener('click',installApp);
  byId('pepInstallAppHeader')?.addEventListener('click',installApp);
  setInstallVisible(false);
});
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
}
