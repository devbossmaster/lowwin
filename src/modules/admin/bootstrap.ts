import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { emailAdapter } from './email';
import { digest,token } from './crypto';
export async function bootstrapOwner(client:PrismaClient,email:string) {
  if(process.env.ADMIN_BOOTSTRAP_ENABLED!=='true')throw new Error('Owner bootstrap is disabled');
  email=z.email().max(254).parse(email.trim().toLowerCase());const mail=emailAdapter();const invitation=token();
  return client.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:first-owner',0))`;
    if(await tx.ownerBootstrap.count()||await tx.staffMember.count())throw new Error('Owner bootstrap has already been used');
    if(await tx.user.findUnique({where:{email}}))throw new Error('Use a separate staff credential identity');
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    await tx.ownerBootstrap.create({data:{id:'owner'}});
    await tx.staffToken.create({data:{tokenHash:digest(invitation),kind:'INVITE',email,expiresAt:new Date(now.getTime()+86400000)}});
    await tx.adminAudit.create({data:{actorId:'bootstrap',action:'OWNER_INVITED',target:'owner',details:{email}}});
    const link=new URL('/admin/login',process.env.BETTER_AUTH_URL);link.hash=new URLSearchParams({invite:invitation}).toString();
    await mail.send({to:email,subject:'Your Lowwin Owner invitation',text:`Accept your one-time Owner invitation within 24 hours: ${link}\nYou must enroll an authenticator before any admin access.`});
    return {invited:true};
  },{timeout:15000});
}

/** Deliberate operator command, not an HTTP endpoint. Exactly one recovery of
 * the original unclaimed invitation; never provisions a second Owner. */
export async function reissueInitialOwner(client:PrismaClient,reason:string) {
  if(process.env.ADMIN_BOOTSTRAP_ENABLED!=='true')throw new Error('Owner bootstrap is disabled');
  reason=z.string().trim().min(5).max(500).parse(reason);const mail=emailAdapter();
  return client.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:first-owner',0))`;
    if(!await tx.ownerBootstrap.count()||await tx.staffMember.count()||await tx.adminAudit.count({where:{action:'OWNER_INVITE_REISSUED'}}))throw new Error('Initial invitation recovery is unavailable');
    const initial=await tx.adminAudit.findFirstOrThrow({where:{action:'OWNER_INVITED'}}),email=(initial.details as {email:string}).email;
    const old=await tx.staffToken.findFirst({where:{kind:'INVITE',email,role:'OWNER'},orderBy:{createdAt:'desc'}});
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    if(!old||old.usedAt||old.expiresAt>now||await tx.user.findUnique({where:{email}}))throw new Error('Only an expired unclaimed initial invitation can be reissued');
    const invitation=token();await tx.staffToken.update({where:{tokenHash:old.tokenHash},data:{usedAt:now}});
    await tx.staffToken.create({data:{tokenHash:digest(invitation),kind:'INVITE',role:'OWNER',email,expiresAt:new Date(now.getTime()+86400000)}});
    await tx.adminAudit.create({data:{actorId:'bootstrap',action:'OWNER_INVITE_REISSUED',target:'owner',details:{reason}}});
    const link=new URL('/admin/login',process.env.BETTER_AUTH_URL);link.hash=new URLSearchParams({invite:invitation}).toString();
    await mail.send({to:email,subject:'Replacement Lowwin Owner invitation',text:`The expired invitation was revoked. Enroll MFA after accepting within 24 hours: ${link}`});
    return {reissued:true};
  },{timeout:15000});
}
