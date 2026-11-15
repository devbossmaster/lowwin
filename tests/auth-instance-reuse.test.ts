import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Prisma,PrismaClient} from '@prisma/client';

const state=vi.hoisted(()=>({
 env:{BETTER_AUTH_URL:'https://lowwin.test',BETTER_AUTH_SECRET:'test-auth-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:'123456789:test-token-at-least-twenty-characters',TELEGRAM_BOT_USERNAME:'lowwin_test_bot',NODE_ENV:'test',APP_ENV:'local',DATABASE_URL:'postgresql://postgres@127.0.0.1/auth_test'},
 login:null as null|{clientId:string;clientSecret:string;origin:string;callback:string},
 client:{$transaction:()=>{}},
 build:vi.fn((options:unknown)=>({options,instance:Symbol('auth')})),
}));
vi.mock('better-auth',()=>({betterAuth:state.build}));
vi.mock('better-auth-telegram',()=>({telegram:()=>({id:'telegram'})}));
vi.mock('../src/lib/db',()=>({db:state.client}));
vi.mock('../src/lib/env',()=>({getEnv:()=>({...state.env})}));
vi.mock('../src/modules/admin/email',()=>({emailAdapter:()=>({send:vi.fn()})}));
vi.mock('../src/modules/auth/telegram-login',()=>({telegramLoginSettings:()=>state.login}));
vi.mock('../src/modules/auth/telegram-oidc-identity',()=>({prepareTelegramOIDCIdentity:vi.fn()}));
vi.mock('../src/modules/auth/telegram-oidc-token-request',()=>({telegramOIDCTokenRequest:()=>({id:'telegram-token-request'})}));
import {createAuth} from '../src/modules/auth/server';

const client=()=>({$transaction:vi.fn()}) as unknown as PrismaClient;
beforeEach(()=>{state.build.mockClear();state.env.BETTER_AUTH_URL='https://lowwin.test';state.env.BETTER_AUTH_SECRET='test-auth-secret-'+Math.random()+'-thirty-two-characters';state.env.TELEGRAM_BOT_TOKEN='123456789:test-token-at-least-twenty-characters';state.env.TELEGRAM_BOT_USERNAME='lowwin_test_bot';state.login={clientId:'123456789',clientSecret:'test-only-client-secret',origin:'https://lowwin.test',callback:'https://lowwin.test/api/auth/callback/telegram-oidc'}});

describe('request-safe Better Auth instance reuse',()=>{
 it('keeps one upstream provider/JWKS cache for the same client and configuration',()=>{
  const db=client(),first=createAuth(db);expect(createAuth(db)).toBe(first);expect(createAuth(db)).toBe(first);expect(state.build).toHaveBeenCalledOnce();
  expect(state.build.mock.calls[0][0]).toMatchObject({account:{skipStateCookieCheck:false,storeStateStrategy:'database'},session:{cookieCache:{enabled:false}},advanced:{defaultCookieAttributes:{httpOnly:true,sameSite:'lax'}}});
 });
 it('never shares an auth adapter across database clients',()=>{
  const first=client(),second=client();expect(createAuth(first)).not.toBe(createAuth(second));expect(state.build).toHaveBeenCalledTimes(2);
 });
 it('never retains an interactive transaction client for another request',()=>{
  const transaction={} as Prisma.TransactionClient;expect(createAuth(transaction)).not.toBe(createAuth(transaction));expect(state.build).toHaveBeenCalledTimes(2);
 });
 it.each(['session-secret','bot-token','origin','client-secret','oidc-disabled','database'] as const)('invalidates the current entry when %s changes',change=>{
  const db=client(),first=createAuth(db);
  if(change==='session-secret')state.env.BETTER_AUTH_SECRET+='rotated';
  if(change==='bot-token')state.env.TELEGRAM_BOT_TOKEN+='rotated';
  if(change==='origin'){state.env.BETTER_AUTH_URL='https://other-lowwin.test';state.login={...state.login!,origin:state.env.BETTER_AUTH_URL,callback:state.env.BETTER_AUTH_URL+'/api/auth/callback/telegram-oidc'}}
  if(change==='client-secret')state.login={...state.login!,clientSecret:'rotated-test-client-secret'};
  if(change==='oidc-disabled')state.login=null;
  if(change==='database')state.env.DATABASE_URL='postgresql://postgres@127.0.0.1/other_auth_test';
  const current=createAuth(db);expect(current).not.toBe(first);expect(createAuth(db)).toBe(current);expect(state.build).toHaveBeenCalledTimes(2);
 });
 it('reuses the default application client without caching an authentication response',()=>{
  expect(createAuth()).toBe(createAuth());expect(state.build).toHaveBeenCalledOnce();expect(state.build.mock.calls[0][0]).not.toHaveProperty('session.user');
 });
});
