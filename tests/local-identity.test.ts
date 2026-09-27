import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { assertLocalDevelopment, parseEnv } from '../src/lib/env';
import { assertLocalIdentityAccess, assertLocalIdentitySurface } from '../src/modules/auth/local-identity';
import { LOCAL_ACCESS_KEY, signedLaunch, TEST_TOKEN } from './helpers';

const local = {
  NODE_ENV:'test', APP_ENV:'local', DATABASE_URL:'postgresql://test@127.0.0.1:5432/local_test', DIRECT_URL:'postgresql://test@127.0.0.1:5432/local_test',
  BETTER_AUTH_URL:'http://localhost:3000', MINI_APP_URL:'http://localhost:3000', BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',
  TELEGRAM_BOT_TOKEN:TEST_TOKEN, TELEGRAM_BOT_USERNAME:'lowin_fixture_bot', TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',
  DEV_IDENTITY_ENABLED:'true', DEV_POINTS_ENABLED:'false', DEV_IDENTITY_ACCESS_KEY:LOCAL_ACCESS_KEY,
};
describe('local identity boundary',()=>{
  it('allows explicitly configured localhost development with the private operator key',()=>{
    expect(()=>parseEnv(local)).not.toThrow();
    expect(()=>assertLocalIdentityAccess(new Headers({origin:local.BETTER_AUTH_URL,host:'localhost:3000'}),{accessKey:LOCAL_ACCESS_KEY},local,local.BETTER_AUTH_URL)).not.toThrow();
  });
  it.each(['https://lowin.ngrok-free.app','https://lowin.example','https://preview.vercel.app','http://192.168.1.10:3000'])('rejects public configured origin %s even with fully rewritten local headers',origin=>{
    for (const raw of [{...local,BETTER_AUTH_URL:origin},{...local,MINI_APP_URL:origin},{...local,BETTER_AUTH_URL:origin,MINI_APP_URL:origin}]) {
      expect(()=>parseEnv(raw)).toThrow();
      expect(()=>assertLocalDevelopment('identity',raw)).toThrow();
      expect(()=>assertLocalIdentitySurface(new Headers({host:'localhost:3000'}),raw)).toThrow();
      expect(()=>assertLocalIdentityAccess(new Headers({origin:local.BETTER_AUTH_URL,host:'localhost:3000'}),{accessKey:LOCAL_ACCESS_KEY},raw,local.BETTER_AUTH_URL)).toThrow();
    }
  });
  it.each([
    {host:'lowin.ngrok-free.app'}, {'x-forwarded-host':'lowin.ngrok-free.app'}, {'x-forwarded-host':'localhost:3000, lowin.example'},
    {'x-original-host':'lowin.example'}, {origin:'https://lowin.ngrok-free.app'}, {'x-forwarded-for':'203.0.113.10'},
    {forwarded:'for=127.0.0.1;host=localhost:3000'}, {'x-real-ip':'203.0.113.10'},
  ])('rejects public or ambiguous request metadata %j',extra=>{
    const headers=new Headers({origin:local.BETTER_AUTH_URL,host:'localhost:3000'});
    for (const [name,value] of Object.entries(extra)) if (value !== undefined) headers.set(name,value);
    expect(()=>assertLocalIdentityAccess(headers,{accessKey:LOCAL_ACCESS_KEY},local,local.BETTER_AUTH_URL)).toThrow();
    expect(()=>assertLocalIdentitySurface(headers,local)).toThrow();
  });
  it('rejects a public request URL despite forged local Origin and Host',()=>{
    expect(()=>assertLocalIdentityAccess(new Headers({origin:local.BETTER_AUTH_URL,host:'localhost:3000'}),{accessKey:LOCAL_ACCESS_KEY},local,'https://lowin.ngrok-free.app/api/auth/lowin/dev-identity')).toThrow();
  });
  it('does not authorize headers rewritten by a proxy without the out-of-band key',()=>{
    const headers=new Headers({origin:local.BETTER_AUTH_URL,host:'localhost:3000','x-forwarded-host':'localhost:3000','x-forwarded-for':'127.0.0.1'});
    expect(()=>assertLocalIdentityAccess(headers,{},local,local.BETTER_AUTH_URL)).toThrow();
    expect(()=>assertLocalIdentityAccess(headers,{accessKey:'wrong-operator-key-with-valid-length'},local,local.BETTER_AUTH_URL)).toThrow();
    expect(()=>parseEnv({...local,DEV_IDENTITY_ACCESS_KEY:undefined})).toThrow();
  });
  it('permits public Telegram configuration only with local identity disabled',()=>{
    expect(()=>parseEnv({...local,DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'https://lowin.ngrok-free.app',MINI_APP_URL:'https://lowin.ngrok-free.app'})).not.toThrow();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('local identity persistence boundary',()=>{
  let db:PrismaClient;
  beforeAll(()=>{
    const url=new URL(process.env.TEST_DATABASE_URL!);
    if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Disposable loopback _test database required');
    Object.assign(process.env,local,{DATABASE_URL:url.toString(),DIRECT_URL:url.toString()});
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
    db=new PrismaClient();
  },60000);
  afterAll(async()=>{await db?.$disconnect();const {db:authDb}=await import('../src/lib/db');await authDb.$disconnect();});
  const request=(url:string,headers:Record<string,string>,body:unknown={accessKey:LOCAL_ACCESS_KEY})=>new Request(`${url}/api/auth/lowin/dev-identity`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  async function counts(){return {users:await db.user.count(),sessions:await db.session.count()};}
  it('public configuration cannot create a user/session even if the proxy rewrites every header',async()=>{
    const {handleAuth}=await import('../src/modules/auth/handler');
    const before=await counts();
    Object.assign(process.env,{BETTER_AUTH_URL:'https://lowin.ngrok-free.app',MINI_APP_URL:'https://lowin.ngrok-free.app'});
    try {
      for(const req of [request('https://lowin.ngrok-free.app',{origin:'https://lowin.ngrok-free.app',host:'lowin.ngrok-free.app'}),request(local.BETTER_AUTH_URL,{origin:local.BETTER_AUTH_URL,host:'localhost:3000','x-forwarded-for':'127.0.0.1'})]){
        const response=await handleAuth(req);expect(response.status).toBe(503);expect(response.headers.get('set-cookie')).toBeNull();
      }
      expect(await counts()).toEqual(before);
    } finally {Object.assign(process.env,{BETTER_AUTH_URL:local.BETTER_AUTH_URL,MINI_APP_URL:local.MINI_APP_URL});}
  });
  it('denies forged-local requests without a key and public hosts without persistence',async()=>{
    const {handleAuth}=await import('../src/modules/auth/handler');const before=await counts();
    const cases=[request(local.BETTER_AUTH_URL,{origin:local.BETTER_AUTH_URL,host:'localhost:3000'},{}),request(local.BETTER_AUTH_URL,{origin:local.BETTER_AUTH_URL,host:'localhost:3000','x-forwarded-host':'public.example'}),request('https://public.example',{origin:local.BETTER_AUTH_URL,host:'localhost:3000'})];
    for(const req of cases){const response=await handleAuth(req);expect(response.status).toBe(401);expect(response.headers.get('set-cookie')).toBeNull();}
    expect(await counts()).toEqual(before);
  });
  it('retains the localhost identity session flow with a correct key',async()=>{
    const {handleAuth}=await import('../src/modules/auth/handler');
    const response=await handleAuth(request(local.BETTER_AUTH_URL,{origin:local.BETTER_AUTH_URL,host:'localhost:3000'}));
    expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const {createAuth}=await import('../src/modules/auth/server');
    const session=await createAuth().api.getSession({headers:new Headers({cookie:response.headers.get('set-cookie')!.split(';')[0]})});
    expect(session?.user.id).toBe('lowin-local-test-user');
  });
  it('still creates a real pinned-plugin Telegram session for signed HTTPS ngrok data with local identity off',async()=>{
    const {handleAuth}=await import('../src/modules/auth/handler');
    const origin='https://lowin.ngrok-free.app';
    const telegramId=randomInt(1000000000,2000000000);
    Object.assign(process.env,{BETTER_AUTH_URL:origin,MINI_APP_URL:origin,DEV_IDENTITY_ENABLED:'false'});
    try{
      const response=await handleAuth(new Request(`${origin}/api/auth/telegram/miniapp/signin`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Tunnel fixture'})})})}));
      expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('Secure');
      expect(await db.user.count({where:{telegramId:String(telegramId)}})).toBe(1);
      const blocked=await handleAuth(request(origin,{origin}));expect(blocked.status).toBe(401);
    }finally{Object.assign(process.env,{BETTER_AUTH_URL:local.BETTER_AUTH_URL,MINI_APP_URL:local.MINI_APP_URL,DEV_IDENTITY_ENABLED:'true'});}
  });
});
