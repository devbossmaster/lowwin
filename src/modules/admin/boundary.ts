import type { Prisma,PrismaClient } from '@prisma/client';
import { createAuth } from '../auth/server';
import { AdminError } from './errors';
import {assertPermission,type Permission,type StaffRole} from './permissions';
import {adminSessionExpiry} from '@/lib/admin-security';
export const adminHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Robots-Tag':'noindex'};
export async function requireAdmin(tx:Prisma.TransactionClient|PrismaClient,headers:Headers,options:{lock?:boolean;permission?:Permission}={}) {
  const current=await createAuth(tx).api.getSession({headers});
  if(!current)throw new AdminError(401,'Administrator sign-in required.','ADMIN_LOGIN_REQUIRED');
  if(options.lock)await tx.$queryRaw`SELECT u.id FROM "user" u JOIN "StaffMember" s ON s."userId"=u.id WHERE u.id=${current.user.id} FOR UPDATE OF u,s`;
  const now=new Date();
  const grant=await tx.staffSession.findUnique({where:{sessionId:current.session.id},include:{session:{include:{user:{include:{staffMember:true}}}}}});
  const member=grant?.session.user.staffMember;
  const expiresAt=grant?adminSessionExpiry(grant,grant.session.expiresAt,now):null;
  if(!grant||!expiresAt||!member?.active||grant.session.user.role!=='admin'||!grant.session.user.emailVerified||grant.session.telegramLaunchId!==null||grant.session.user.telegramId!==null||grant.session.userId!==current.user.id)throw new AdminError(403,'Sign in with an approved administrator account.','ADMIN_LOGIN_REQUIRED');
  const role:StaffRole='OWNER';
  if(options.permission)assertPermission(role,options.permission);
  return {id:member.userId,role:role as StaffRole,sessionId:grant.sessionId,now,mfaAt:null,expiresAt};
}
