const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');

initializeApp();

const ROLE_PERMISSIONS=Object.freeze({
  ADMINISTRADOR:['system.view','security.view','security.admin','samples.read','samples.write','laboratory.read','laboratory.write','reports.read','reports.write','billing.read','billing.write','receivables.read','receivables.write','clients.read','clients.write','catalogs.read','catalogs.write'],
  CALIDAD:['system.view','security.view','samples.read','samples.write','laboratory.read','laboratory.write','reports.read','reports.write','clients.read','clients.write','catalogs.read','catalogs.write'],
  LABORATORIO:['samples.read','laboratory.read','laboratory.write','reports.read','clients.read','catalogs.read'],
  INFORMES:['samples.read','laboratory.read','reports.read','reports.write','clients.read'],
  FACTURACION:['samples.read','reports.read','billing.read','billing.write','clients.read'],
  COBRANZA:['billing.read','receivables.read','receivables.write','clients.read'],
  CONSULTA:['samples.read','laboratory.read','reports.read','clients.read','catalogs.read']
});
const ALLOWED_ROLES=new Set(Object.keys(ROLE_PERMISSIONS));

function canonicalRole(value){
  const v=String(value||'').trim().toUpperCase();
  const aliases={ADMIN:'ADMINISTRADOR',ADMINISTRATOR:'ADMINISTRADOR',QUALITY:'CALIDAD',LAB:'LABORATORIO',LABORATORY:'LABORATORIO',REPORTS:'INFORMES',REPORT:'INFORMES',BILLING:'FACTURACION','FACTURACIÓN':'FACTURACION',RECEIVABLES:'COBRANZA',COLLECTIONS:'COBRANZA',VIEWER:'CONSULTA',READONLY:'CONSULTA',READ_ONLY:'CONSULTA'};
  return aliases[v]||v;
}
function callerAuthorized(request){
  if(!request.auth)return false;
  const token=request.auth.token||{};
  const role=canonicalRole(token.role||token.pepRole||token.erpRole||token.userRole);
  const bootstrap=String(process.env.PEP_BOOTSTRAP_ADMIN_UID||'').trim();
  return request.auth.uid===bootstrap||role==='ADMINISTRADOR'||token.admin===true||token.securityAdmin===true||token.pepAdmin===true;
}
function requireAuthorized(request){
  if(!request.auth)throw new HttpsError('unauthenticated','Firebase Authentication requerida.');
  if(!callerAuthorized(request))throw new HttpsError('permission-denied','El usuario autenticado no está autorizado para administrar Custom Claims.');
}

exports.pepClaimsAdminStatus=onCall({region:'us-central1'},async request=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Firebase Authentication requerida.');
  const token=request.auth.token||{};
  return {
    ok:true,
    uid:request.auth.uid,
    authorized:callerAuthorized(request),
    role:canonicalRole(token.role||token.pepRole||token.erpRole||token.userRole)||null,
    bootstrapConfigured:!!String(process.env.PEP_BOOTSTRAP_ADMIN_UID||'').trim()
  };
});


exports.pepListAuthUsers=onCall({region:'us-central1'},async request=>{
  requireAuthorized(request);
  const maxResults=Math.max(1,Math.min(1000,Number(request.data?.maxResults)||200));
  const auth=getAuth();
  const result=await auth.listUsers(maxResults);
  const users=result.users.map(user=>{
    const claims=user.customClaims||{};
    const role=canonicalRole(claims.role||claims.pepRole||claims.erpRole||claims.userRole)||null;
    return {
      uid:user.uid,
      email:user.email||null,
      displayName:user.displayName||null,
      disabled:user.disabled===true,
      emailVerified:user.emailVerified===true,
      role:ALLOWED_ROLES.has(role)?role:null,
      createdAt:user.metadata?.creationTime||null,
      lastSignInAt:user.metadata?.lastSignInTime||null
    };
  });
  users.sort((a,b)=>String(a.email||a.displayName||a.uid).localeCompare(String(b.email||b.displayName||b.uid),'es',{sensitivity:'base'}));
  return {ok:true,count:users.length,users};
});

exports.pepSetUserClaims=onCall({region:'us-central1'},async request=>{
  requireAuthorized(request);
  const data=request.data||{};
  const uid=String(data.uid||'').trim();
  const email=String(data.email||'').trim().toLowerCase();
  const role=canonicalRole(data.role);
  if(!uid&&!email)throw new HttpsError('invalid-argument','Debe indicar uid o email.');
  if(!ALLOWED_ROLES.has(role))throw new HttpsError('invalid-argument','Rol no permitido.');
  const auth=getAuth();
  let user;
  try{user=uid?await auth.getUser(uid):await auth.getUserByEmail(email);}catch(e){throw new HttpsError('not-found','Usuario destino no encontrado en Firebase Authentication.');}
  const existing={...(user.customClaims||{})};
  delete existing.admin;delete existing.securityAdmin;delete existing.pepAdmin;
  const next={
    ...existing,
    role,
    pepRole:role,
    permissions:[...ROLE_PERMISSIONS[role]],
    claimsVersion:1,
    claimsUpdatedAt:new Date().toISOString(),
    claimsUpdatedBy:request.auth.uid
  };
  if(role==='ADMINISTRADOR')next.pepAdmin=true;
  await auth.setCustomUserClaims(user.uid,next);
  return {ok:true,uid:user.uid,email:user.email||null,role,permissions:[...ROLE_PERMISSIONS[role]],claimsUpdatedAt:next.claimsUpdatedAt};
});


function auditAdmin(action, request, targetUser, extra={}){
  const row={
    event:'PEP_SECURITY_ADMIN_AUDIT',
    action,
    actorUid:request.auth?.uid||null,
    actorEmail:request.auth?.token?.email||null,
    targetUid:targetUser?.uid||extra.targetUid||null,
    targetEmail:targetUser?.email||extra.targetEmail||null,
    at:new Date().toISOString(),
    ...extra
  };
  console.info(JSON.stringify(row));
  return row;
}

function safePassword(value){
  const v=String(value||'');
  if(v.length<6)throw new HttpsError('invalid-argument','La contraseña debe tener al menos 6 caracteres.');
  if(v.length>128)throw new HttpsError('invalid-argument','La contraseña excede la longitud permitida.');
  return v;
}

async function resolveUser(auth,{uid,email}={}){
  const id=String(uid||'').trim();
  const mail=String(email||'').trim().toLowerCase();
  if(!id&&!mail)throw new HttpsError('invalid-argument','Debe indicar uid o email.');
  try{return id?await auth.getUser(id):await auth.getUserByEmail(mail);}
  catch(e){throw new HttpsError('not-found','Usuario no encontrado en Firebase Authentication.');}
}

async function applyRole(auth,user,role,actorUid){
  const r=canonicalRole(role);
  if(!ALLOWED_ROLES.has(r))throw new HttpsError('invalid-argument','Rol no permitido.');
  const existing={...(user.customClaims||{})};
  delete existing.admin;delete existing.securityAdmin;delete existing.pepAdmin;
  const next={
    ...existing,
    role:r,
    pepRole:r,
    permissions:[...ROLE_PERMISSIONS[r]],
    claimsVersion:1,
    claimsUpdatedAt:new Date().toISOString(),
    claimsUpdatedBy:actorUid
  };
  if(r==='ADMINISTRADOR')next.pepAdmin=true;
  await auth.setCustomUserClaims(user.uid,next);
  return next;
}

exports.pepCreateAuthUser=onCall({region:'us-central1'},async request=>{
  requireAuthorized(request);
  const data=request.data||{};
  const email=String(data.email||'').trim().toLowerCase();
  const password=safePassword(data.password);
  const displayName=String(data.displayName||'').trim();
  const role=canonicalRole(data.role||'CONSULTA');
  if(!email||!email.includes('@'))throw new HttpsError('invalid-argument','Email inválido.');
  if(!ALLOWED_ROLES.has(role))throw new HttpsError('invalid-argument','Rol no permitido.');
  const auth=getAuth();
  let user;
  try{
    user=await auth.createUser({email,password,displayName:displayName||undefined,disabled:false,emailVerified:false});
    await applyRole(auth,user,role,request.auth.uid);
  }catch(e){
    if(user?.uid){try{await auth.deleteUser(user.uid);}catch(_){}}
    if(e?.code==='auth/email-already-exists')throw new HttpsError('already-exists','Ya existe un usuario con ese email.');
    throw e;
  }
  const fresh=await auth.getUser(user.uid);
  const audit=auditAdmin('USER_CREATED',request,fresh,{role});
  return {ok:true,user:{uid:fresh.uid,email:fresh.email||null,displayName:fresh.displayName||null,disabled:fresh.disabled,emailVerified:fresh.emailVerified,role},audit};
});

exports.pepUpdateAuthUser=onCall({region:'us-central1'},async request=>{
  requireAuthorized(request);
  const data=request.data||{},auth=getAuth();
  const user=await resolveUser(auth,data);
  const patch={};
  if(Object.prototype.hasOwnProperty.call(data,'displayName'))patch.displayName=String(data.displayName||'').trim()||null;
  if(Object.prototype.hasOwnProperty.call(data,'email')){
    const mail=String(data.email||'').trim().toLowerCase();
    if(!mail||!mail.includes('@'))throw new HttpsError('invalid-argument','Email inválido.');
    patch.email=mail;
  }
  if(!Object.keys(patch).length)throw new HttpsError('invalid-argument','No hay cambios de perfil para guardar.');
  let updated;
  try{updated=await auth.updateUser(user.uid,patch);}catch(e){
    if(e?.code==='auth/email-already-exists')throw new HttpsError('already-exists','Ese email ya está asignado a otro usuario.');
    throw e;
  }
  const audit=auditAdmin('USER_PROFILE_UPDATED',request,updated,{changedFields:Object.keys(patch)});
  return {ok:true,user:{uid:updated.uid,email:updated.email||null,displayName:updated.displayName||null,disabled:updated.disabled,emailVerified:updated.emailVerified},audit};
});

exports.pepSetUserDisabled=onCall({region:'us-central1'},async request=>{
  requireAuthorized(request);
  const data=request.data||{},auth=getAuth();
  const user=await resolveUser(auth,data);
  const disabled=data.disabled===true;
  if(user.uid===request.auth.uid&&disabled)throw new HttpsError('failed-precondition','No puede suspender su propia sesión administrativa.');
  const updated=await auth.updateUser(user.uid,{disabled});
  if(disabled)await auth.revokeRefreshTokens(user.uid);
  const audit=auditAdmin(disabled?'USER_DISABLED':'USER_ENABLED',request,updated,{disabled});
  return {ok:true,uid:updated.uid,email:updated.email||null,disabled:updated.disabled,audit};
});

exports.pepSetUserPassword=onCall({region:'us-central1'},async request=>{
  requireAuthorized(request);
  const data=request.data||{},auth=getAuth();
  const user=await resolveUser(auth,data);
  const password=safePassword(data.password);
  const updated=await auth.updateUser(user.uid,{password});
  if(data.revokeSessions!==false)await auth.revokeRefreshTokens(user.uid);
  const audit=auditAdmin('USER_PASSWORD_CHANGED',request,updated,{sessionsRevoked:data.revokeSessions!==false});
  return {ok:true,uid:updated.uid,email:updated.email||null,audit};
});

exports.pepGeneratePasswordResetLink=onCall({region:'us-central1'},async request=>{
  requireAuthorized(request);
  const data=request.data||{},auth=getAuth();
  const user=await resolveUser(auth,data);
  if(!user.email)throw new HttpsError('failed-precondition','El usuario no tiene email registrado.');
  const link=await auth.generatePasswordResetLink(user.email);
  const audit=auditAdmin('PASSWORD_RESET_LINK_GENERATED',request,user,{});
  return {ok:true,uid:user.uid,email:user.email,resetLink:link,audit};
});
