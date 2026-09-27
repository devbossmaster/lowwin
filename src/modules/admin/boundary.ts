import type { Prisma,PrismaClient } from '@prisma/client';
import { createAuth } from '../auth/server';
import { AdminError } from './errors';
import {assertPermission,staffRoles,type Permission,type StaffRole} from './permissions';
export const adminHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Robots-Tag':'noindex'};
export async function requireAdmin(tx:Prisma.TransactionClient|PrismaClient,headers:Headers,options:{fresh?:boolean;lock?:boolean;permission?:Permission}={}) {
  const current=await createAuth(tx).api.getSession({headers});
  if(!current)throw new AdminError(401,'Staff credentials and MFA are required.');
  if(options.lock)await tx.$queryRaw`SELECT "userId" FROM "StaffMember" WHERE "userId"=${current.user.id} FOR UPDATE`;
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const grant=await tx.staffSession.findUnique({where:{sessionId:current.session.id},include:{session:{include:{user:{include:{staffMember:true}}}}}});
  const member=grant?.session.user.staffMember;
  if(!grant?.mfaAt||!member?.active||!staffRoles.includes(member.role as StaffRole)||!grant.session.user.emailVerified||grant.session.userId!==current.user.id||grant.expiresAt<=now||grant.session.expiresAt<=now||grant.credentialAt.getTime()+8*3600000<now.getTime())throw new AdminError(403,'An active credential-plus-MFA staff session is required.');
  if(options.fresh&&now.getTime()-grant.mfaAt.getTime()>5*60000)throw new AdminError(403,'Fresh MFA is required. Confirm a new authenticator code.');
  if(options.permission)assertPermission(member.role,options.permission);
  return {id:member.userId,role:member.role as StaffRole,sessionId:grant.sessionId,now,mfaAt:grant.mfaAt,expiresAt:grant.expiresAt};
}
