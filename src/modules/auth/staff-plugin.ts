import type {Prisma,PrismaClient} from '@prisma/client';
import {APIError} from 'better-auth/api';
import {ADMIN_SESSION_MS} from '@/lib/admin-security';

type Client=Prisma.TransactionClient|PrismaClient;
const loginPath='/sign-in/email';
export const staffActions=[] as const;

/** Approval is a database-only change. Never trust role claims in a body or cookie. */
export async function approvedAdmin(client:Client,userId:string){
 const user=await client.user.findUnique({where:{id:userId},select:{id:true,role:true,emailVerified:true,telegramId:true,staffMember:{select:{active:true}}}});
 if(!user||user.role!=='admin'||!user.emailVerified||user.telegramId!==null||user.staffMember?.active===false)throw new APIError('FORBIDDEN',{code:'ADMIN_APPROVAL_REQUIRED',message:'Your account needs email verification and administrator approval.'});
 return user;
}

/** Better Auth database hooks run only for the ordinary email/password sign-in.
 * Telegram sessions cannot receive a staff credential marker. */
export function masterAdminDatabaseHooks(client:Client){
 return {
  user:{create:{before:async()=>({data:{role:'member'}})}},
  session:{create:{
   before:async(session:{userId:string;createdAt?:Date;expiresAt:Date},context:{path?:string}|null)=>{
    if(context?.path!==loginPath)return;
    await approvedAdmin(client,session.userId);
    return {data:{...session,expiresAt:new Date(Math.min(session.expiresAt.getTime(),(session.createdAt?.getTime()??Date.now())+ADMIN_SESSION_MS))}};
   },
   after:async(session:{id:string;userId:string;createdAt:Date;expiresAt:Date},context:{path?:string}|null)=>{
    if(context?.path!==loginPath)return;
    try{
     await approvedAdmin(client,session.userId);
     // Fulfillment assignments retain this compatibility FK; permissions come
     // exclusively from the fresh User.role check, never this legacy role.
     await client.staffMember.upsert({where:{userId:session.userId},create:{userId:session.userId,role:'OWNER',active:true,recoveryHashes:[]},update:{}});
     await client.staffSession.create({data:{sessionId:session.id,credentialAt:session.createdAt,expiresAt:new Date(Math.min(session.expiresAt.getTime(),session.createdAt.getTime()+ADMIN_SESSION_MS)),authMethod:'email-password',mfaAt:null}});
     await client.adminAudit.create({data:{actorId:session.userId,action:'ADMIN_PASSWORD_SIGNED_IN',target:session.userId,details:{}}});
    }catch(error){await client.session.deleteMany({where:{id:session.id,userId:session.userId}});throw error}
   },
  }},
 };
}
