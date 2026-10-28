import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {hashPassword} from 'better-auth/crypto';

/** Business tests use approved accounts; onboarding itself is tested in master-admin-auth.test.ts. */
export async function verifiedAdminFixture(db:PrismaClient,handleAuth:(request:Request)=>Promise<Response>,options:{email:string;password:string;origin:string}) {
 const target=new URL(process.env.DATABASE_URL??'');
 if(process.env.NODE_ENV!=='test'||!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Administrator fixtures require a disposable loopback test database.');
 const id=randomUUID(),password=await hashPassword(options.password);
 await db.user.create({data:{id,email:options.email,name:'Approved fixture administrator',emailVerified:true,role:'admin'}});
 await db.account.create({data:{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password}});
 const response=await handleAuth(new Request(`${options.origin}/api/auth/sign-in/email`,{method:'POST',headers:{origin:options.origin,'content-type':'application/json'},body:JSON.stringify({email:options.email,password:options.password,rememberMe:false})}));
 if(response.status!==200)throw new Error(`Fixture administrator sign-in failed (${response.status}).`);
 const cookie=response.headers.getSetCookie().find(value=>value.includes('session_token='))?.split(';')[0];
 if(!cookie)throw new Error('Fixture administrator did not receive a session cookie.');
 return {id,cookie};
}
