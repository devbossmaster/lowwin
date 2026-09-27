import { randomUUID } from 'node:crypto';
import type { Prisma,PrismaClient } from '@prisma/client';
import { APIError,createAuthEndpoint,getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie,deleteSessionCookie } from 'better-auth/cookies';
import { hashPassword,verifyPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { digest,token,newTotpSecret,seal,unseal,verifyTotp } from '../admin/crypto';
import { emailAdapter } from '../admin/email';
import {staffRoles,type StaffRole} from '../admin/permissions';
import { AdminError } from '../admin/errors';

export const staffActions=['accept-invite','login','enroll','mfa','step-up','forgot','reset','logout'] as const;
const emailSchema=z.email().max(254).transform(value=>value.toLowerCase());
const passwordSchema=z.string().min(12).max(128);
const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export function staffPlugin(tx:Prisma.TransactionClient|PrismaClient) {
  const endpoints=Object.fromEntries(staffActions.map(action=>[`staff_${action}`,createAuthEndpoint(`/lowin/staff/${action}`,{method:'POST',body:z.unknown()},async ctx=>{
    try {
      let [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const refreshClock=async()=>{[{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`};
      const audit=(actorId:string,event:string,target=actorId)=>tx.adminAudit.create({data:{actorId,action:event,target,details:{}}});
      async function issue(userId:string,credentialAt:Date,mfaAt:Date|null=null) {
        const user=await ctx.context.internalAdapter.findUserById(userId);if(!user)throw new AdminError(401,'Staff sign-in failed.');
        const session=await ctx.context.internalAdapter.createSession(userId,true);if(!session)throw new Error('Session unavailable');
        await tx.staffSession.create({data:{sessionId:session.id,credentialAt,mfaAt,expiresAt:new Date(now.getTime()+15*60000)}});
        await setSessionCookie(ctx,{session,user},true);
      }
      if(action==='accept-invite') {
        const body=z.object({token:tokenSchema,password:passwordSchema}).strict().parse(ctx.body),hash=digest(body.token);
        await tx.$queryRaw`SELECT "tokenHash" FROM "StaffToken" WHERE "tokenHash"=${hash} FOR UPDATE`;
        const invite=await tx.staffToken.findUnique({where:{tokenHash:hash}});
        await refreshClock();
        if(!invite||invite.kind!=='INVITE'||invite.usedAt||invite.expiresAt<=now)throw new AdminError(400,'Invitation is invalid or expired.');
        if(await tx.user.findUnique({where:{email:invite.email}}))throw new AdminError(409,'Invitation cannot be used for an existing identity.');
        const id=randomUUID();await tx.user.create({data:{id,name:invite.role==='OWNER'?'Owner':'Staff',email:invite.email,emailVerified:true}});
        await tx.account.create({data:{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password:await hashPassword(body.password)}});
        await tx.staffMember.create({data:{userId:id,role:invite.role,recoveryHashes:[]}});await tx.staffToken.update({where:{tokenHash:hash},data:{usedAt:now}});
        await issue(id,now);await audit(id,'OWNER_INVITATION_ACCEPTED');return ctx.json({mode:'enroll'});
      }
      if(action==='login') {
        const body=z.object({email:emailSchema,password:passwordSchema}).strict().parse(ctx.body);
        const identity=await tx.user.findUnique({where:{email:body.email},select:{id:true}});
        if(identity)await tx.$queryRaw`SELECT "userId" FROM "StaffMember" WHERE "userId"=${identity.id} FOR UPDATE`;
        const user=await tx.user.findUnique({where:{email:body.email},include:{staffMember:true,accounts:{where:{providerId:'credential'}}}}),account=user?.accounts[0];
        if(!user?.staffMember?.active||!staffRoles.includes(user.staffMember.role as StaffRole)||!user.emailVerified||!account?.password){await hashPassword(body.password);throw new AdminError(401,'Email or password could not be verified.')}
        if(!await verifyPassword({password:body.password,hash:account.password}))throw new AdminError(401,'Email or password could not be verified.');
        await refreshClock();await issue(user.id,now);await audit(user.id,'STAFF_CREDENTIAL_ACCEPTED');return ctx.json({mode:user.staffMember.secret?'challenge':'enroll'});
      }
      if(action==='forgot') {
        const body=z.object({email:emailSchema}).strict().parse(ctx.body);
        let mail;try{mail=emailAdapter()}catch{throw new AdminError(503,'Email delivery is unavailable.')}
        const user=await tx.user.findUnique({where:{email:body.email},select:{id:true,emailVerified:true,staffMember:{select:{active:true}}}});
        if(user?.staffMember?.active&&user.emailVerified){
          const reset=token();await tx.staffToken.create({data:{tokenHash:digest(reset),kind:'RESET',email:body.email,expiresAt:new Date(now.getTime()+30*60000)}});
          const link=new URL('/admin/login',process.env.BETTER_AUTH_URL);link.hash=new URLSearchParams({reset}).toString();
          await mail.send({to:body.email,subject:'Reset your Lowin staff password',text:`Reset your password within 30 minutes: ${link}\nExisting sessions will be revoked. Your authenticator is still required.`});await audit(user.id,'PASSWORD_RESET_REQUESTED');
        }
        return ctx.json({message:'If this address belongs to an active staff account, reset instructions will be sent.'});
      }
      if(action==='reset') {
        const body=z.object({token:tokenSchema,password:passwordSchema}).strict().parse(ctx.body),hash=digest(body.token);
        await tx.$queryRaw`SELECT "tokenHash" FROM "StaffToken" WHERE "tokenHash"=${hash} FOR UPDATE`;
        const reset=await tx.staffToken.findUnique({where:{tokenHash:hash}});
        await refreshClock();
        if(!reset||reset.kind!=='RESET'||reset.usedAt||reset.expiresAt<=now)throw new AdminError(400,'Reset link is invalid or expired.');
        const user=await tx.user.findUnique({where:{email:reset.email},include:{staffMember:true}});
        if(!user?.staffMember?.active)throw new AdminError(400,'Reset link is invalid or expired.');
        await tx.$queryRaw`SELECT "userId" FROM "StaffMember" WHERE "userId"=${user.id} FOR UPDATE`;
        await refreshClock();
        if(!(await tx.staffMember.findUnique({where:{userId:user.id}}))?.active||reset.expiresAt<=now)throw new AdminError(400,'Reset link is invalid or expired.');
        await tx.account.updateMany({where:{userId:user.id,providerId:'credential'},data:{password:await hashPassword(body.password)}});
        await tx.session.deleteMany({where:{userId:user.id}});await tx.staffToken.updateMany({where:{email:reset.email,kind:'RESET',usedAt:null},data:{usedAt:now}});
        await audit(user.id,'PASSWORD_RESET_SESSIONS_REVOKED');deleteSessionCookie(ctx);return ctx.json({mode:'login',message:'Password reset. Sign in again with your authenticator.'});
      }
      const current=await getSessionFromCtx(ctx,{disableCookieCache:true,disableRefresh:true});
      if(!current)throw new AdminError(401,'Staff sign-in required.');
      await tx.$queryRaw`SELECT "userId" FROM "StaffMember" WHERE "userId"=${current.user.id} FOR UPDATE`;
      await refreshClock();
      const member=await tx.staffMember.findUnique({where:{userId:current.user.id}}),grant=await tx.staffSession.findUnique({where:{sessionId:current.session.id}});
      if(!member?.active||!staffRoles.includes(member.role as StaffRole)||!current.user.emailVerified||!grant||grant.expiresAt<=now||grant.credentialAt.getTime()+8*3600000<now.getTime())throw new AdminError(401,'Credential session expired. Sign in again.');
      if(action==='logout'){z.object({}).strict().parse(ctx.body);await tx.session.delete({where:{id:current.session.id}});deleteSessionCookie(ctx);await audit(member.userId,'STAFF_SIGNED_OUT');return ctx.json({mode:'login'})}
      if(action==='enroll'){
        z.object({}).strict().parse(ctx.body);if(member.secret||grant.mfaAt)throw new AdminError(409,'Authenticator is already enrolled.');
        const secret=grant.pendingSecret?unseal(grant.pendingSecret):newTotpSecret();
        if(!grant.pendingSecret){await tx.staffSession.update({where:{sessionId:grant.sessionId},data:{pendingSecret:seal(secret)}});await audit(member.userId,'MFA_ENROLLMENT_STARTED')}
        return ctx.json({secret,uri:`otpauth://totp/${encodeURIComponent(`Lowin:${current.user.email}`)}?secret=${secret}&issuer=Lowin&algorithm=SHA1&digits=6&period=30`});
      }
      const {code}=z.object({code:z.string().trim().min(6).max(64)}).strict().parse(ctx.body);
      if(action==='step-up'&&!grant.mfaAt)throw new AdminError(403,'Complete MFA before requesting fresh assurance.');
      if(action==='mfa'&&grant.mfaAt)throw new AdminError(409,'Use step-up for an enrolled admin session.');
      if(member.secret&&!/^\d{6}$/.test(code)&&action==='mfa'){
        const recoveryHash=digest(code),index=member.recoveryHashes.indexOf(recoveryHash);if(index<0)throw new AdminError(401,'Authenticator or recovery code could not be verified.');
        await tx.staffMember.update({where:{userId:member.userId},data:{secret:null,recoveryHashes:[],lastCounter:-1n}});
        await tx.session.deleteMany({where:{userId:member.userId}});await issue(member.userId,grant.credentialAt);await audit(member.userId,'MFA_RECOVERY_SESSIONS_REVOKED');return ctx.json({mode:'enroll',message:'Recovery accepted. Enroll a new authenticator before admin access.'});
      }
      const encrypted=member.secret??grant.pendingSecret;if(!encrypted)throw new AdminError(409,'Start authenticator enrollment first.');
      const counter=verifyTotp(unseal(encrypted),code,now,member.lastCounter);
      if(counter===null)throw new AdminError(401,'Authenticator code invalid or already used. Wait for the next code.');
      const recoveryCodes=member.secret?undefined:Array.from({length:10},()=>token().slice(0,24));
      await tx.staffMember.update({where:{userId:member.userId},data:{secret:encrypted,lastCounter:counter,...(recoveryCodes?{recoveryHashes:recoveryCodes.map(digest)}:{})}});
      if(action==='step-up')await tx.staffSession.update({where:{sessionId:grant.sessionId},data:{mfaAt:now,expiresAt:new Date(now.getTime()+15*60000)}});
      else {await tx.session.delete({where:{id:current.session.id}});await issue(member.userId,grant.credentialAt,now)}
      await audit(member.userId,recoveryCodes?'MFA_ENROLLED':action==='step-up'?'MFA_STEP_UP':'MFA_CHALLENGE_PASSED');
      return ctx.json({mode:'authenticated',...(recoveryCodes?{recoveryCodes}:{})});
    }catch(error){
      if(error instanceof AdminError)throw new APIError(error.status===401?'UNAUTHORIZED':error.status===403?'FORBIDDEN':error.status===409?'CONFLICT':error.status===503?'SERVICE_UNAVAILABLE':'BAD_REQUEST',{message:error.message});
      if(error instanceof z.ZodError)throw new APIError('BAD_REQUEST',{message:'Check the supplied fields.'});
      throw new APIError('SERVICE_UNAVAILABLE',{message:'Staff authentication is temporarily unavailable.'});
    }
  })])) as unknown as Record<`staff_${typeof staffActions[number]}`,ReturnType<typeof createAuthEndpoint>>;
  return {id:'lowin-staff',endpoints};
}
