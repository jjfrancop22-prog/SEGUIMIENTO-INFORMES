export class AuthProvider{
  get name(){return 'AUTH_PROVIDER'}
  get mode(){return 'UNCONFIGURED'}
  async init(){return this.status()}
  status(){return {provider:this.name,mode:this.mode,ready:false,authenticated:false,user:null,lastError:null}}
  onIdentityChanged(){return ()=>{}}
  async signIn(){throw new Error('Proveedor de autenticación no implementado.')}
  async signOut(){return true}
  async getIdToken(){return null}
  async refreshIdToken(){return null}
}
