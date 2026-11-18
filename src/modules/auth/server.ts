import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError,addOAuthServerContext,createAuthEndpoint,createAuthMiddleware,getOAuthState } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { telegram } from 'better-auth-telegram';
import {createHash} from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { assertLocalIdentityAccess } from './local-identity';
import { masterAdminDatabaseHooks } from './staff-plugin';
import {emailAdapter} from '../admin/email';
import {TELEGRAM_LOGIN_PROVIDER,telegramLoginSettings,type TelegramLoginSettings} from './telegram-login';
import {prepareTelegramOIDCIdentity} from './telegram-oidc-identity';
import {authLogSummary} from './safe-logger';
import {telegramOIDCTokenRequest} from './telegram-oidc-token-request';
import {oidcProof,telegramOIDCCallback,telegramSessionClient,telegramSessionConflict} from './telegram-oidc-session';
import {measureTelegramAuth} from './telegram-timing';
import {websiteReferralFromCookie} from '../referrals/website-cookie';
import {referralInviteCode} from '@/lib/referral-invite';

// One bounded entry per live Prisma client preserves the upstream provider's
// remote-JWKS cache. This shares configuration, never sessions or verified
// claims. Transaction clients are deliberately never retained or reused.
const instances=new WeakMap<object,{configuration:string;auth:ReturnType<typeof buildAuth>}>();
export function createAuth(client: PrismaClient | Prisma.TransactionClient = db) {
  const env=getEnv(),login=telegramLoginSettings();
  const configuration=createHash('sha256').update(JSON.stringify({env,login})).digest('hex');
  const cacheable=typeof (client as PrismaClient).$transaction==='function',prior=cacheable?instances.get(client):undefined;
  if(prior?.configuration===configuration)return prior.auth;
  const auth=buildAuth(client,env,login);if(cacheable)instances.set(client,{configuration,auth});return auth;
}
function buildAuth(client:PrismaClient|Prisma.TransactionClient,env:ReturnType<typeof getEnv>,login:TelegramLoginSettings|null){
  const staffHooks=masterAdminDatabaseHooks(client);
  const sessionClient=login&&'$extends' in client?telegramSessionClient(client,login.clientId):client;
  return betterAuth({
    appName: 'Lowwin', baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(sessionClient, { provider: 'postgresql' }),
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    logger:{level:'error',log:(level,message,...args)=>{console.warn('authentication_operation_unavailable',{level,...authLogSummary(args,message)})}},
    user:{additionalFields:{role:{type:'string',defaultValue:'member',input:false,required:false}}},
    emailAndPassword: {
      enabled:true,disableSignUp:false,autoSignIn:false,requireEmailVerification:true,
      minPasswordLength:12,maxPasswordLength:128,revokeSessionsOnPasswordReset:true,resetPasswordTokenExpiresIn:1800,
      sendResetPassword:async({user,url})=>emailAdapter().send({to:user.email,subject:'Reset your Lowwin password',text:`Reset your password within 30 minutes: ${url}\nYour existing sessions will be revoked.`}),
    },
    emailVerification:{sendOnSignUp:true,sendOnSignIn:true,autoSignInAfterVerification:false,expiresIn:1800,
      sendVerificationEmail:async({user,url})=>emailAdapter().send({to:user.email,subject:'Verify your Lowwin email',text:`Verify your email within 30 minutes: ${url}\nVerification confirms your email. Administrator access requires separate approval.`}),
    },
    hooks:{before:createAuthMiddleware(async ctx=>{
      if(['/sign-up/email','/sign-in/email'].includes(ctx.path)&&ctx.body&&['role','emailVerified','staffMember','isAdmin'].some(key=>key in ctx.body))throw new APIError('BAD_REQUEST',{message:'Account permissions cannot be supplied during registration or sign-in.'});
      if(ctx.path==='/sign-in/social'&&ctx.body?.provider===TELEGRAM_LOGIN_PROVIDER){
        const referral=websiteReferralFromCookie(new Headers(ctx.headers));
        if(referral)await addOAuthServerContext({lowwinWebsiteReferral:referral});
      }
    })},
    databaseHooks:{...staffHooks,
      user:{create:{before:async()=>({data:{role:'member',telegramPhoneNumber:null}})},update:{before:async(data:Record<string,unknown>)=>({data:{...data,telegramPhoneNumber:null}})}},
      session:{create:{
        before:staffHooks.session.create.before,
        after:async(session,context)=>{
          await staffHooks.session.create.after(session,context);
          if(!telegramOIDCCallback(context))return;
          const proof=await oidcProof.get();
          if(!proof||proof.sessionId!==session.id){
            // Fail closed if an adapter change ever bypasses the guarded insert.
            await client.session.deleteMany({where:{id:session.id,userId:session.userId}});
            throw telegramSessionConflict();
          }
        },
      }},
    },
    account: { accountLinking: { enabled: false },storeStateStrategy:'database',skipStateCookieCheck:false,storeAccountCookie:false,updateAccountOnSignIn:false,encryptOAuthTokens:true },
    onAPIError:{errorURL:env.BETTER_AUTH_URL+'/?login=1'},
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: env.BETTER_AUTH_URL.startsWith('https:'), defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' } },
    rateLimit: { enabled:true,storage:'database',window:60,max:30,customRules:{'/sign-up/email':{window:60,max:3},'/sign-in/email':{window:60,max:5},'/send-verification-email':{window:60,max:3},'/request-password-reset':{window:60,max:3},'/reset-password':{window:60,max:5}} },
    plugins: [telegram({ botToken: env.TELEGRAM_BOT_TOKEN, botUsername: env.TELEGRAM_BOT_USERNAME,
      loginWidget: false, maxAuthAge: 300,allowUserToLink:false,
      miniApp: { enabled: true, validateInitData: true, allowAutoSignin: false },
      oidc:login?{enabled:true,clientId:login.clientId,clientSecret:login.clientSecret,requestPhone:true,requestBotAccess:true,disableIdTokenSignIn:true,disableSignUp:true,
        mapOIDCProfileToUser:async claims=>{
          if(!('$transaction' in client))throw new APIError('FORBIDDEN',{message:'Browser login requires its own request.'});
          const websiteReferralCode=referralInviteCode((await getOAuthState())?.serverContext?.lowwinWebsiteReferral);
          const profile=await measureTelegramAuth('oidc_identity',()=>prepareTelegramOIDCIdentity(claims,{...login,websiteReferralCode},client as PrismaClient));
          await oidcProof.set({telegramId:String(claims.id),subject:claims.sub});
          return profile;
        },
      }:undefined,
    }), telegramOIDCTokenRequest(login), {
      id: 'lowin-local-development', endpoints: {
        localIdentity: createAuthEndpoint('/lowin/dev-identity', { method: 'POST' }, async ctx => {
          // Repeat the full gate for direct internal Better Auth API invocation.
          assertLocalIdentityAccess(new Headers(ctx.headers), ctx.body, process.env, ctx.request?.url);
          const id = 'lowin-local-test-user';
          let user = await ctx.context.internalAdapter.findUserById(id);
          if (!user) user = await ctx.context.internalAdapter.createUser({ id, name: 'Local test player', email: 'local-test@lowin.invalid', emailVerified: false }, { method: 'lowin-local-development' });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        }),
      },
    }],
  });
}
