import {verifyFixtureContact} from './contact-fixtures';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomInt} from 'node:crypto';
import {signedLaunch,TEST_TOKEN} from './helpers';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('Telegram-only entry boundary',()=>{
 let db:PrismaClient,auth:typeof import('../src/modules/auth/handler').handleAuth,access:typeof import('../src/modules/auth/mini-access');
 beforeAll(async()=>{const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable database required');Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two'});execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});db=new PrismaClient();({handleAuth:auth}=await import('../src/modules/auth/handler'));access=await import('../src/modules/auth/mini-access')},60000);
 // Independent boundary cases share one loopback address, not one login quota.
 beforeEach(async()=>{await db.rateLimit.deleteMany()});
 afterAll(async()=>{await db?.rateLimit.deleteMany();await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 const sign=async(raw:string,cookie?:string)=>{try{const user=JSON.parse(new URLSearchParams(raw).get('user')??'null');if(user?.id)await verifyFixtureContact(db,user.id)}catch{}return launch(raw,cookie)};
 const launch=(raw:string,cookie?:string)=>auth(new Request('http://localhost:3000/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({initData:raw})}));
 const cookies=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 it('syncs the verified Telegram photo on first and resumed launches without changing identity',async()=>{
  const id=randomInt(6600000000,6700000000),photo='https://t.me/i/userpic/320/first.jpg',next='https://t.me/i/userpic/320/updated.jpg';
  const raw=(photo_url?:string)=>signedLaunch({user:JSON.stringify({id,first_name:'Photo fixture',...(photo_url?{photo_url}:{})})});
  const first=await sign(raw(photo)),initial=await first.json(),cookie=cookies(first);expect(first.status).toBe(200);expect(initial.me.user.image).toBe(photo);
  const updated=await launch(raw(next),cookie),body=await updated.json();expect(body.me.user).toMatchObject({id:initial.me.user.id,image:next});
  expect(await db.session.count({where:{userId:initial.me.user.id}})).toBe(1);
  const {GET}=await import('../src/app/api/me/route');expect((await (await GET(new Request('http://localhost:3000/api/me',{headers:{cookie}}))).json()).user.image).toBe(next);
  const tampered=new URLSearchParams(raw(next));tampered.set('user',JSON.stringify({id,first_name:'Photo fixture',photo_url:'https://t.me/i/userpic/320/forged.jpg'}));expect((await launch(tampered.toString(),cookie)).status).toBe(401);expect((await db.user.findUniqueOrThrow({where:{id:initial.me.user.id}})).image).toBe(next);
  const removed=await launch(raw(),cookie);expect((await removed.json()).me.user.image).toBeNull();expect((await db.user.findUniqueOrThrow({where:{id:initial.me.user.id}})).image).toBeNull();
 });
 it('denies guests, spoofed browser headers and forged or stale launches',async()=>{expect(await access.getMiniSession(new Headers({'user-agent':'Telegram','x-telegram-user-id':'1'}),db)).toBeNull();expect((await sign('forged')).status).toBe(401);expect((await sign(signedLaunch({auth_date:'1'}))).status).toBe(401)});
 it('binds the exact issued session to verified Telegram identity and denies unbound or revoked sessions',async()=>{const response=await sign(signedLaunch({user:JSON.stringify({id:randomInt(6000000000,6100000000),first_name:'Boundary test'})}));expect(response.status).toBe(200);const headers=new Headers({cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')});const session=await access.getMiniSession(headers,db);expect(session).not.toBeNull();await db.session.update({where:{id:session!.session.id},data:{telegramLaunchId:null}});expect(await access.getMiniSession(headers,db)).toBeNull();await db.session.update({where:{id:session!.session.id},data:{telegramLaunchId:'wrong-identity'}});expect(await access.getMiniSession(headers,db)).toBeNull();await db.session.delete({where:{id:session!.session.id}});expect(await access.getMiniSession(headers,db)).toBeNull()});
 it('public tunnel configuration cannot enable the local preview exception',()=>{const old=process.env.MINI_APP_URL;process.env.MINI_APP_URL='https://example.ngrok-free.app';try{expect(access.localMiniPreview(new Headers({host:'localhost:3000','x-forwarded-host':'localhost:3000'}))).toBe(false)}finally{process.env.MINI_APP_URL=old}});
 it('returns the private account at sign-in and reuses only the same live Telegram session',async()=>{
  const raw=signedLaunch({user:JSON.stringify({id:randomInt(6100000000,6200000000),first_name:'Bootstrap'})});
  const first=await sign(raw),cookie=cookies(first),body=await first.json();
  expect(body).toMatchObject({ok:true,status:'authenticated',me:{user:{name:'Lowwin player'}}});
  expect(body).not.toHaveProperty('session');expect(body).not.toHaveProperty('token');
  expect(first.headers.get('cache-control')).toContain('no-store');expect(first.headers.get('vary')).toBe('Cookie');
  const session=await access.getMiniSession(new Headers({cookie}),db);
  const again=await launch(raw,cookie);
  expect((await again.json()).me.user.id).toBe(session!.user.id);
  expect(await db.session.count({where:{userId:session!.user.id}})).toBe(1);
  expect((await access.getMiniSession(new Headers({cookie}),db))!.session.id).toBe(session!.session.id);
  expect((await launch('forged',cookie)).status).toBe(401);
  expect((await launch(signedLaunch({auth_date:'1'}),cookie)).status).toBe(401);
 });
 it('does not return the previous player when a different signed Telegram identity opens',async()=>{
  const first=await sign(signedLaunch({user:JSON.stringify({id:randomInt(6200000000,6300000000),first_name:'First'})}));
  const firstBody=await first.json();
  const secondTelegramId=randomInt(6300000000,6400000000);
  const second=await sign(signedLaunch({user:JSON.stringify({id:secondTelegramId,first_name:'Second'})}),cookies(first));
  const body=await second.json();expect(body.me.user.id).not.toBe(firstBody.me.user.id);
  expect((await db.user.findUniqueOrThrow({where:{id:body.me.user.id}})).telegramId).toBe(String(secondTelegramId));
  expect(await access.getMiniSession(new Headers({cookie:cookies(second)}),db)).not.toBeNull();
 });
 it('rechecks contact revocation on resumed sessions before returning any account data',async()=>{
  const raw=signedLaunch({user:JSON.stringify({id:randomInt(6400000000,6500000000),first_name:'Revoked'})});
  const first=await sign(raw),cookie=cookies(first),body=await first.json();
  await db.telegramOwnContact.update({where:{userId:body.me.user.id},data:{revokedAt:new Date()}});
  const again=await launch(raw,cookie);expect(await again.json()).toEqual({ok:true,status:'contact-required',me:null});
  const {GET}=await import('../src/app/api/me/route');
  expect((await GET(new Request('http://localhost:3000/api/me',{headers:{cookie}}))).status).toBe(401);
 });
 it('does not reuse an unbound website session as Telegram proof',async()=>{
  const raw=signedLaunch({user:JSON.stringify({id:randomInt(6500000000,6600000000),first_name:'Unbound'})});
  const first=await sign(raw),cookie=cookies(first),session=await access.getMiniSession(new Headers({cookie}),db);
  await db.session.update({where:{id:session!.session.id},data:{telegramLaunchId:null}});
  const again=await launch(raw,cookie);expect(again.status).toBe(200);
  expect(cookies(again)).not.toBe(cookie);
  expect((await access.getMiniSession(new Headers({cookie:cookies(again)}),db))!.session.id).not.toBe(session!.session.id);
  expect(await access.getMiniSession(new Headers({cookie}),db)).toBeNull();
 });
});
