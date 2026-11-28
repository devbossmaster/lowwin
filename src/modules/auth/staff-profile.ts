import type {Prisma} from '@prisma/client';
import {verifyJWT} from 'better-auth/crypto';
import {db} from '@/lib/db';
import {getEnv} from '@/lib/env';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {adminHeaders,requireAdmin} from '../admin/boundary';
import {AdminError} from '../admin/errors';
import {createAuth} from './server';

const profilePath = '/admin/profile';
const profileHeaders = {...adminHeaders,'Referrer-Policy':'no-referrer'};
const transactionOptions = {maxWait:5000,timeout:15000};

function authRequest(request:Request,path:string,body:object) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('Content-Type','application/json');
  return new Request(new URL(`/api/auth/${path}`,getEnv().BETTER_AUTH_URL),{
    method:'POST',headers,body:JSON.stringify(body),
  });
}

async function recordCredentialChange(tx:Prisma.TransactionClient,userId:string,action:'ADMIN_PASSWORD_CHANGED'|'ADMIN_EMAIL_CHANGED') {
  await tx.session.deleteMany({where:{userId}});
  await tx.verification.deleteMany({where:{value:userId,identifier:{startsWith:'reset-password:'}}});
  await tx.adminAudit.create({data:{actorId:userId,action,target:userId,details:{}}});
}

async function signedOutHeaders(auth:ReturnType<typeof createAuth>,request:Request) {
  const headers = new Headers(profileHeaders);
  const signedOut = await auth.api.signOut({headers:request.headers,asResponse:true});
  if (!signedOut.ok) throw new Error('Administrator authentication cookies could not be cleared.');
  for (const cookie of signedOut.headers.getSetCookie()) headers.append('Set-Cookie',cookie);
  return headers;
}

export async function changeStaffPassword(request:Request,input:{currentPassword:string;newPassword:string}) {
  const requester = await requireAdmin(db,request.headers);
  await limitProfileAction(requester.id,'password',5);
  return db.$transaction(async tx => {
    const actor = await requireAdmin(tx,request.headers,{lock:true});
    const auth = createAuth(tx);
    const changed = await auth.handler(authRequest(request,'change-password',{
      ...input,revokeOtherSessions:false,
    }));
    if (changed.status===429) return Response.json({error:'Too many attempts. Wait a minute and try again.'},{status:429,headers:profileHeaders});
    if (!changed.ok) {
      const result = await changed.json().catch(()=>null);
      if (result?.code==='INVALID_PASSWORD') return Response.json({error:'Current password is incorrect.'},{status:400,headers:profileHeaders});
      throw new AdminError(503,'Your password could not be changed. Try again.');
    }

    await recordCredentialChange(tx,actor.id,'ADMIN_PASSWORD_CHANGED');
    return Response.json({ok:true},{headers:await signedOutHeaders(auth,request)});
  },transactionOptions);
}

export async function requestStaffEmailChange(request:Request,newEmail:string) {
  const actor = await requireAdmin(db,request.headers);
  await limitProfileAction(actor.id,'email',3);
  const account = await db.user.findUniqueOrThrow({where:{id:actor.id},select:{email:true}});
  if (account.email?.toLowerCase()===newEmail) throw new AdminError(400,'Enter an email address different from your current address.');
  const response = await createAuth().handler(authRequest(request,'change-email',{newEmail,callbackURL:profilePath}));
  if (response.status===429) throw new AdminError(429,'Too many attempts. Wait a minute and try again.');
  if (!response.ok) throw new AdminError(503,'Email confirmation could not be started. Try again.');
  return Response.json({ok:true},{headers:profileHeaders});
}

async function limitProfileAction(userId:string,action:'email'|'password',maximum:number) {
  if (!await allowIdentityRequest(db,`admin-profile-${action}`,userId,maximum)) {
    throw new AdminError(429,'Too many attempts. Wait a minute and try again.');
  }
}

export async function handleStaffEmailVerification(request:Request,secret:string) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (token && token.length > 4096) return new Response(null,{status:400,headers:profileHeaders});
  const claims = token ? await verifyJWT<Record<string,unknown>>(token,secret) : null;
  if (!claims?.updateTo) return createAuth().handler(request);

  const rejected = () => new Response(null,{status:303,headers:{...profileHeaders,Location:`${profilePath}?emailChange=invalid`}});
  const {requestType,userId,email,updateTo} = claims;
  if (url.searchParams.get('callbackURL')!==profilePath
    || typeof userId!=='string' || typeof email!=='string' || typeof updateTo!=='string'
    || (requestType!=='change-email-confirmation' && requestType!=='change-email-verification')) return rejected();

  try {
    if (requestType==='change-email-confirmation') {
      const actor = await requireAdmin(db,request.headers);
      if (actor.id!==userId) return rejected();
      if (!await allowIdentityRequest(db,'admin-profile-email-link',actor.id,3)) return rejected();
      const response = await createAuth().handler(request);
      if (response.headers.get('location')!==profilePath) return response;
      return new Response(null,{status:303,headers:{...profileHeaders,Location:`${profilePath}?emailChange=verify-new`}});
    }

    return await db.$transaction(async tx => {
      const actor = await requireAdmin(tx,request.headers,{lock:true});
      if (actor.id!==userId) return rejected();
      const previous = await tx.user.findUniqueOrThrow({where:{id:actor.id},select:{email:true}});
      if (previous.email?.toLowerCase()!==email || email===updateTo) return rejected();

      const auth = createAuth(tx);
      const response = await auth.handler(request);
      if (response.headers.get('location')!==profilePath) return response;
      const changed = await tx.user.findUniqueOrThrow({where:{id:actor.id},select:{email:true,emailVerified:true}});
      if (changed.email?.toLowerCase()!==updateTo || !changed.emailVerified) throw new Error('Verified administrator email was not updated.');
      // The database also revokes sessions when the sign-in address changes.
      await recordCredentialChange(tx,actor.id,'ADMIN_EMAIL_CHANGED');
      const headers = await signedOutHeaders(auth,request);
      headers.set('Location','/admin/login?emailChanged=1');
      return new Response(null,{status:303,headers});
    },transactionOptions);
  } catch (error) {
    if (error instanceof AdminError) return rejected();
    throw error;
  }
}
