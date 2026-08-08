export class StartupManager{
  constructor({
    openDatabase,
    securityManager,
    createSessionGate,
    initializeAuthenticatedERP,
    lockAuthenticatedERP,
    onReady=()=>{},
    onError=()=>{}
  }={}){
    this.openDatabase=openDatabase;
    this.securityManager=securityManager;
    this.createSessionGate=createSessionGate;
    this.initializeAuthenticatedERP=initializeAuthenticatedERP;
    this.lockAuthenticatedERP=lockAuthenticatedERP;
    this.onReady=onReady;
    this.onError=onError;
    this.state='NEW';
    this.bootPromise=null;
    this.authenticatedPromise=null;
    this.authenticatedReady=false;
    this.sessionGate=null;
  }
  status(){
    return Object.freeze({
      state:this.state,
      bootStarted:!!this.bootPromise,
      authenticatedReady:this.authenticatedReady,
      sessionUnlocked:!!this.sessionGate?.unlocked
    });
  }
  async boot(){
    if(this.bootPromise)return this.bootPromise;
    this.bootPromise=this.#bootOnce();
    return this.bootPromise;
  }
  async #bootOnce(){
    try{
      this.state='OPENING_DATABASE';
      await this.openDatabase();

      this.state='INITIALIZING_SECURITY';
      await this.securityManager.init();

      this.state='INITIALIZING_SESSION_GATE';
      this.sessionGate=this.createSessionGate({
        onAuthenticated:async context=>this.ensureAuthenticatedERP(context),
        onLocked:async()=>this.lockERP()
      });
      await this.sessionGate.init();

      this.state=this.sessionGate.unlocked?'READY':'WAITING_AUTH';
      await this.onReady(this.status());
      return this.status();
    }catch(error){
      this.state='ERROR';
      await this.onError(error,this.status());
      throw error;
    }
  }
  async ensureAuthenticatedERP(context={}){
    if(this.authenticatedReady){
      this.state='RESTORING_AUTHENTICATED_RUNTIME';
      await this.initializeAuthenticatedERP({...context,alreadyInitialized:true});
      this.state='READY';
      return true;
    }
    if(this.authenticatedPromise)return this.authenticatedPromise;
    this.authenticatedPromise=(async()=>{
      this.state='INITIALIZING_AUTHENTICATED_RUNTIME';
      try{
        await this.initializeAuthenticatedERP({...context,alreadyInitialized:false});
        this.authenticatedReady=true;
        this.state='READY';
        return true;
      }finally{
        this.authenticatedPromise=null;
      }
    })();
    return this.authenticatedPromise;
  }
  async lockERP(){
    this.state='LOCKING';
    await this.lockAuthenticatedERP();
    this.state='WAITING_AUTH';
    return true;
  }
}
