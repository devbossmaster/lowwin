import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError,createAuthEndpoint,createAuthMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { telegram } from 'better-auth-telegram';
import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { assertLocalIdentityAccess } from './local-identity';
import { masterAdminDatabaseHooks } from './staff-plugin';
import {emailAdapter} from '../admin/email';

export function createAuth(client: PrismaClient | Prisma.TransactionClient = db) {
  const env = getEnv();
  return betterAuth({
    appName: 'Lowwin', baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(client, { provider: 'postgresql' }),
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    logger:{level:'error',log:()=>{console.warn('Authentication operation unavailable.')}},
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
    databaseHooks:masterAdminDatabaseHooks(client),
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: env.BETTER_AUTH_URL.startsWith('https:'), defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' } },
    rateLimit: { enabled:true,storage:'database',window:60,max:30,customRules:{'/sign-up/email':{window:60,max:3},'/sign-in/email':{window:60,max:5},'/send-verification-email':{window:60,max:3},'/request-password-reset':{window:60,max:3},'/reset-password':{window:60,max:5}} },
    plugins: [telegram({ botToken: env.TELEGRAM_BOT_TOKEN, botUsername: env.TELEGRAM_BOT_USERNAME,
      loginWidget: false, maxAuthAge: 300,
      miniApp: { enabled: true, validateInitData: true, allowAutoSignin: true },
    }), {
      id: 'lowin-local-development', endpoints: {
        localIdentity: createAuthEndpoint('/lowin/dev-identity', { method: 'POST' }, async ctx => {
          // Repeat the full gate for direct internal Better Auth API invocation.
          assertLocalIdentityAccess(new Headers(ctx.headers), ctx.body, process.env, ctx.request?.url);
          const id = 'lowin-local-test-user';
          let user = await ctx.context.internalAdapter.findUserById(id);
          if (!user) user = await ctx.context.internalAdapter.createUser({ id, name: 'Local test player', email: 'local-test@lowin.invalid', emailVerified: false });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        }),
      },
    }],
  });
}
