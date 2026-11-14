import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError,createAuthEndpoint,createAuthMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { telegram } from 'better-auth-telegram';
import {defineRequestState} from '@better-auth/core/context';
import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { assertLocalIdentityAccess } from './local-identity';
import { masterAdminDatabaseHooks } from './staff-plugin';
import {emailAdapter} from '../admin/email';
import {telegramLoginSettings} from './telegram-login';
import {prepareTelegramOIDCIdentity} from './telegram-oidc-identity';
import {authLogSummary} from './safe-logger';

const oidcProof=defineRequestState<{telegramId:string;subject:string}|null>(()=>null);

export function createAuth(client: PrismaClient | Prisma.TransactionClient = db) {
  const env = getEnv();
  const login=telegramLoginSettings(),staffHooks=masterAdminDatabaseHooks(client);
  return betterAuth({
    appName: 'Lowwin', baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(client, { provider: 'postgresql' }),
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    logger:{level:'error',log:(level,_message,...args)=>{console.warn('authentication_operation_unavailable',{level,...authLogSummary(args)})}},
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
    })},
    databaseHooks:{...staffHooks,
      user:{create:{before:async()=>({data:{role:'member',telegramPhoneNumber:null}})},update:{before:async(data:Record<string,unknown>)=>({data:{...data,telegramPhoneNumber:null}})}},
      session:{create:{
        before:staffHooks.session.create.before,
        after:async(session,context)=>{
          await staffHooks.session.create.after(session,context);
          if(context?.path!=='/callback/:id'||context.params?.id!=='telegram-oidc')return;
          const proof=await oidcProof.get();
          try{
            if(!proof||!login)throw Error('Missing verified Telegram identity');
            const bound=await client.session.updateMany({where:{id:session.id,userId:session.userId,user:{telegramId:proof.telegramId,role:'member',staffMember:null,accounts:{some:{providerId:'telegram-oidc',accountId:proof.subject,telegramId:proof.telegramId}},ownContact:{is:{botId:login.clientId,telegramId:proof.telegramId,userId:session.userId,revokedAt:null}}}},data:{telegramLaunchId:proof.telegramId,telegramAuthSource:'TELEGRAM_OIDC'}});
            if(bound.count!==1)throw Error('Telegram session binding rejected');
          }catch{
            await client.session.deleteMany({where:{id:session.id,userId:session.userId}});
            throw new APIError('FORBIDDEN',{code:'conflict',message:'Telegram account could not be connected safely.'});
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
      miniApp: { enabled: true, validateInitData: true, allowAutoSignin: true },
      oidc:login?{enabled:true,clientId:login.clientId,clientSecret:login.clientSecret,requestPhone:true,requestBotAccess:true,disableIdTokenSignIn:true,disableSignUp:true,
        mapOIDCProfileToUser:async claims=>{
          if(!('$transaction' in client))throw new APIError('FORBIDDEN',{message:'Browser login requires its own request.'});
          const profile=await prepareTelegramOIDCIdentity(claims,login,client as PrismaClient);
          await oidcProof.set({telegramId:String(claims.id),subject:claims.sub});
          return profile;
        },
      }:undefined,
    }), {
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
