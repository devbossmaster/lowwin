import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {makeSignature} from 'better-auth/crypto';
const f=vi.hoisted(()=>({getSession:vi.fn(),read:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{$queryRaw:f.read}}));
vi.mock('../src/modules/auth/server',()=>({createAuth:()=>({api:{getSession:f.getSession}})}));
vi.mock('../src/modules/auth/local-identity',()=>({assertLocalIdentitySurface:()=>{throw Error('No preview')}}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> '123'}));
vi.mock('../src/lib/env',()=>({getEnv:()=>({BETTER_AUTH_URL:process.env.BETTER_AUTH_URL??'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-session-signing-secret-at-least-thirty-two'})}));
import {getLaunchSession,getMiniSession} from '../src/modules/auth/mini-access';
const secret='fixture-session-signing-secret-at-least-thirty-two',cookies=new Map<string,string>();
const bound=()=>({id:'session-a',token:'a',userId:'user-a',name:'Player',image:null,createdAt:new Date(),updatedAt:new Date(),expiresAt:new Date(Date.now()+3600000),telegramLaunchId:'456',telegramId:'456',staffId:null as string|null,contactTelegramId:'456',contactBotId:'123',revokedAt:null as Date|null,lastFour:'1234'});
const headers=(token='a',secure=false)=>new Headers({cookie:`${secure?'__Secure-':''}better-auth.session_token=${encodeURIComponent(cookies.get(token)??token)}`});
beforeEach(async()=>{vi.clearAllMocks();vi.stubEnv('BETTER_AUTH_URL','http://localhost:3000');for(const token of ['a','b'])cookies.set(token,`${token}.${await makeSignature(token,secret)}`);f.getSession.mockReset().mockResolvedValue({session:{id:'session-a'},user:{id:'user-a'}});f.read.mockReset().mockImplementation(async()=>[bound()])});

describe('one-read, signed Mini App sessions',()=>{
 it('shares one unfinished database verification for a same-session burst',async()=>{
  let release!:(value:ReturnType<typeof bound>[])=>void;f.read.mockImplementation(()=>new Promise(resolve=>{release=resolve}));
  const requests=Array.from({length:12},()=>getMiniSession(headers()));await vi.waitFor(()=>expect(f.read).toHaveBeenCalledOnce());release([bound()]);
  expect((await Promise.all(requests)).every(result=>result?.user.id==='user-a')).toBe(true);expect(f.getSession).not.toHaveBeenCalled();
 });
 it('keeps different cookies and transactional reads isolated',async()=>{
  const tx={$queryRaw:vi.fn(async()=>[bound()])} as unknown as Prisma.TransactionClient;
  await Promise.all([getMiniSession(headers()),getMiniSession(headers('b')),getMiniSession(headers(),tx)]);expect(f.read).toHaveBeenCalledTimes(2);expect(tx.$queryRaw).toHaveBeenCalledOnce();
 });
 it('never caches success after contact revocation or a failed read',async()=>{
  expect(await getMiniSession(headers())).not.toBeNull();f.read.mockResolvedValueOnce([{...bound(),revokedAt:new Date()}]);expect(await getMiniSession(headers())).toBeNull();
  f.read.mockRejectedValueOnce({code:'P2024'});expect((await Promise.allSettled([getMiniSession(headers()),getMiniSession(headers())])).every(value=>value.status==='rejected')).toBe(true);
  expect(await getMiniSession(headers())).not.toBeNull();expect(f.getSession).not.toHaveBeenCalled();
 });
 it('distinguishes launch-only from contact-enrolled authorization',async()=>{
  f.read.mockResolvedValue([{...bound(),contactTelegramId:null}]);const [launch,mini]=await Promise.all([getLaunchSession(headers()),getMiniSession(headers())]);expect(launch?.contactStatus).toEqual({verified:false,masked:null});expect(mini).toBeNull();expect(f.read).toHaveBeenCalledTimes(2);
 });
 it('returns only the masked contact and fresh session identity',async()=>{
  const session=await getLaunchSession(headers());expect(session?.contactStatus).toEqual({verified:true,masked:'•••• 1234'});expect(session).not.toHaveProperty('phoneCipher');expect(session).not.toHaveProperty('phoneHash');expect(f.read).toHaveBeenCalledOnce();
 });
 it.each(['unbound','mismatch','staff','wrong-contact','wrong-bot','revoked'] as const)('rejects %s bindings on the next request',async kind=>{
  const row=bound();if(kind==='unbound')row.telegramLaunchId='';if(kind==='mismatch')row.telegramLaunchId='other';if(kind==='staff')row.staffId='user-a';if(kind==='wrong-contact')row.contactTelegramId='other';if(kind==='wrong-bot')row.contactBotId='other';if(kind==='revoked')row.revokedAt=new Date();f.read.mockResolvedValue([row]);expect(await getMiniSession(headers())).toBeNull();
 });
 it('rejects unsigned, forged and wrong-secret cookies without a database read',async()=>{
  const values=['forged','a.'+'x'.repeat(43)+'=',`a.${await makeSignature('a','wrong-private-secret')}`];for(const value of values)expect(await getMiniSession(new Headers({cookie:'better-auth.session_token='+encodeURIComponent(value)}))).toBeNull();expect(f.read).not.toHaveBeenCalled();expect(f.getSession).not.toHaveBeenCalled();
 });
 it('requires the secure cookie name on HTTPS',async()=>{
  vi.stubEnv('BETTER_AUTH_URL','https://localhost:3000');expect(await getMiniSession(headers())).toBeNull();expect(await getMiniSession(headers('a',true))).not.toBeNull();expect(f.read).toHaveBeenCalledOnce();
 });
 it('preserves daily Better Auth renewal and rechecks revocation after it',async()=>{
  f.read.mockResolvedValueOnce([{...bound(),updatedAt:new Date(Date.now()-2*86400000)}]).mockResolvedValueOnce([{...bound(),revokedAt:new Date()}]);expect(await getMiniSession(headers())).toBeNull();expect(f.getSession).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledTimes(2);
 });
});
