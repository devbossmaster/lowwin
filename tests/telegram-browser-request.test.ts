import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
const f=vi.hoisted(()=>({allow:vi.fn(),create:vi.fn(),find:vi.fn(),consume:vi.fn(),cleanup:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:f.allow}));
import {startTelegramBrowserLogin,finishTelegramBrowserLogin} from '../src/modules/auth/telegram-browser';
import {telegramBrowserSettings,validTelegramBrowserRequest} from '../src/modules/auth/telegram-browser-protocol';
const raw={APP_ENV:'production',NODE_ENV:'production',TELEGRAM_LOGIN_ENABLED:'true',TELEGRAM_LOGIN_CLIENT_ID:'123456789',TELEGRAM_LOGIN_CLIENT_SECRET:'synthetic-private-client-secret',TELEGRAM_BOT_TOKEN:'123456789:fixture_only_test_token',BETTER_AUTH_URL:'https://lowwin.shop'};
const settings=telegramBrowserSettings(raw)!;
const startPath='/api/auth/telegram/browser/start?next=%2Fpayments&lang=en';
function requestHeaders(values:Record<string,string|undefined>){const headers=new Headers();for(const [key,value] of Object.entries(values))if(value!==undefined)headers.set(key,value);return headers}
const client={verification:{create:f.create,findUnique:f.find,deleteMany:f.consume},$executeRaw:f.cleanup} as unknown as PrismaClient;
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,'warn').mockImplementation(()=>{});for(const [key,value] of Object.entries(raw))vi.stubEnv(key,value);f.allow.mockResolvedValue(true);f.create.mockImplementation(async({data})=>data);f.cleanup.mockResolvedValue(0);f.consume.mockResolvedValue({count:1})});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()});

describe('canonical Telegram browser login behind an internal transport URL',()=>{
 it.each([
  ['https://lowwin.shop',{}],
  ['https://lowwin.shop',{host:'LOWWIN.SHOP:443','x-forwarded-host':'lowwin.shop','x-forwarded-proto':'https'}],
  ['http://0.0.0.0:3000',{host:'lowwin.shop','x-forwarded-proto':'https'}],
  ['http://container-internal:3000',{host:'lowwin.shop'}],
  ['https://localhost:3000',{host:'lowwin.shop','x-forwarded-host':'LOWWIN.SHOP:443','x-forwarded-proto':'https',origin:'https://lowwin.shop'}],
 ] as const)('accepts canonical public routing for %s %j',async(origin,headers)=>{
  const request=new Request(origin+startPath,{headers:requestHeaders(headers)});expect(validTelegramBrowserRequest(request,settings,'start')).toBe(true);
  const response=await startTelegramBrowserLogin(request,client);expect(response.status).toBe(303);
  const authorization=new URL(response.headers.get('location')!);expect(authorization.origin).toBe('https://oauth.telegram.org');expect(authorization.searchParams.get('redirect_uri')).toBe('https://lowwin.shop/api/auth/telegram/browser/callback');expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');expect(authorization.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(authorization.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(response.headers.get('set-cookie')).toContain('__Host-lowwin.telegram-login=');expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax');expect(response.headers.get('set-cookie')).toContain('; Secure');expect(response.headers.get('cache-control')).toContain('private, no-store');
  const row=f.create.mock.calls[0][0].data,challenge=JSON.parse(row.value);expect(challenge.callback).toBe('https://lowwin.shop/api/auth/telegram/browser/callback');expect(challenge.next).toBe('/payments');expect(challenge.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(response.headers.get('location')).not.toContain(challenge.verifier);expect(response.headers.get('location')).not.toContain(settings.clientSecret);
 });
 it.each([
  {host:'evil.example'},
  {host:'evil.example','x-forwarded-host':'lowwin.shop'},
  {host:'lowwin.shop','x-forwarded-host':'evil.example'},
  {host:'lowwin.shop,evil.example'},
  {host:'lowwin.shop','x-forwarded-host':'lowwin.shop,evil.example'},
  {host:'lowwin.shop','x-forwarded-proto':'http'},
  {host:'lowwin.shop','x-forwarded-proto':'https,http'},
  {host:'lowwin.shop','x-forwarded-proto':'http,https'},
  {host:'lowwin.shop','x-forwarded-proto':'HTTPS'},
  {host:'lowwin.shop/extra'},
  {host:'evil@lowwin.shop'},
  {host:'lowwin.shop:443:443'},
  {host:'lowwin.shop?redirect=evil'},
  {host:'lowwin.shop#evil'},
  {host:'lowwin.shop evil'},
  {host:'lowwin.shop',origin:'https://evil.example'},
  {host:'lowwin.shop',origin:'null'},
  {host:'lowwin.shop',origin:'https://lowwin.shop/extra'},
 ])('rejects conflicting or malformed routing before challenge writes %j',async headers=>{
  const request=new Request('https://lowwin.shop'+startPath,{headers:requestHeaders(headers)});expect(validTelegramBrowserRequest(request,settings,'start')).toBe(false);const response=await startTelegramBrowserLogin(request,client);expect(response.status).toBe(400);expect(f.create).not.toHaveBeenCalled();expect(f.allow).not.toHaveBeenCalled();expect(response.headers.get('set-cookie')).toBeNull();
 });
 it.each([{}, {'x-forwarded-host':'lowwin.shop'}, {'x-forwarded-host':'lowwin.shop','x-forwarded-proto':'https'}])('never lets forwarded host alone approve an internal origin %j',async headers=>{
  const request=new Request('http://0.0.0.0:3000'+startPath,{headers:requestHeaders(headers)});expect(validTelegramBrowserRequest(request,settings,'start')).toBe(false);expect((await startTelegramBrowserLogin(request,client)).status).toBe(400);expect(f.create).not.toHaveBeenCalled();
 });
 it.each(['?next=%2F&next=%2Fpayments','?lang=en&lang=am'])('retains duplicate-query rejection on a correctly routed request %s',async query=>{
  const response=await startTelegramBrowserLogin(new Request('http://0.0.0.0:3000/api/auth/telegram/browser/start'+query,{headers:{host:'lowwin.shop','x-forwarded-proto':'https'}}),client);expect(response.status).toBe(400);expect(f.create).not.toHaveBeenCalled();
 });
 it('supports same-origin local development without trusting a forwarded production host',()=>{
  const local=telegramBrowserSettings({...raw,APP_ENV:'local',NODE_ENV:'test',BETTER_AUTH_URL:'http://localhost:3000'})!;
  expect(validTelegramBrowserRequest(new Request('http://localhost:3000'+startPath),local,'start')).toBe(true);
  expect(validTelegramBrowserRequest(new Request('http://localhost:3000'+startPath,{headers:{host:'lowwin.shop'}}),local,'start')).toBe(false);
 });
 it('allows the real cross-site callback through the same public routing and consumes only bound state',async()=>{
  const headers={host:'lowwin.shop','x-forwarded-host':'lowwin.shop','x-forwarded-proto':'https'},begin=await startTelegramBrowserLogin(new Request('http://0.0.0.0:3000'+startPath,{headers}),client);expect(begin.status).toBe(303);
  const authorization=new URL(begin.headers.get('location')!),state=authorization.searchParams.get('state')!,cookie=begin.headers.get('set-cookie')!.split(';')[0],row=f.create.mock.calls[0][0].data;f.find.mockResolvedValue(row);
  const callback=new Request('http://0.0.0.0:3000/api/auth/telegram/browser/callback?'+new URLSearchParams({state,error:'access_denied'}),{headers:{...headers,cookie,origin:'https://oauth.telegram.org','sec-fetch-site':'cross-site'}}),transport=vi.fn();
  expect(validTelegramBrowserRequest(callback,settings,'callback')).toBe(true);expect(validTelegramBrowserRequest(callback,settings,'start')).toBe(false);
  const response=await finishTelegramBrowserLogin(callback,client,transport);expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('https://lowwin.shop/?telegramLoginError=cancelled&next=%2Fpayments&lang=en');expect(f.find).toHaveBeenCalledTimes(1);expect(f.consume).toHaveBeenCalledTimes(1);expect(transport).not.toHaveBeenCalled();
 });
 it('rejects callback host tampering before reading or consuming a bound challenge',async()=>{
  const transport=vi.fn(),response=await finishTelegramBrowserLogin(new Request('http://0.0.0.0:3000/api/auth/telegram/browser/callback?state='+'s'.repeat(43),{headers:{host:'evil.example','x-forwarded-host':'lowwin.shop','x-forwarded-proto':'https'}}),client,transport);
  expect(response.headers.get('location')).toContain('https://lowwin.shop/?telegramLoginError=invalid');expect(f.find).not.toHaveBeenCalled();expect(f.consume).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith('telegram_browser_login_rejected',{stage:'callback',code:'invalid',diagnostic:'REQUEST_ORIGIN',databaseCode:undefined});
 });
 it('distinguishes missing browser binding without logging authorization data',async()=>{
  const state='s'.repeat(43),code='private-opaque-authorization-code',transport=vi.fn();
  const response=await finishTelegramBrowserLogin(new Request('https://lowwin.shop/api/auth/telegram/browser/callback?'+new URLSearchParams({state,code})),client,transport);
  expect(response.headers.get('location')).toContain('telegramLoginError=invalid');expect(transport).not.toHaveBeenCalled();expect(f.find).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith('telegram_browser_login_rejected',{stage:'browser_binding',code:'invalid',diagnostic:'COOKIE_BINDING',databaseCode:undefined});
  const logged=JSON.stringify(vi.mocked(console.warn).mock.calls);expect(logged).not.toContain(code);expect(logged).not.toContain(state);expect(logged).not.toContain(raw.TELEGRAM_LOGIN_CLIENT_SECRET);
 });
 it('reports an allowlisted missing-table code without leaking database errors or cookies',async()=>{
  const begin=await startTelegramBrowserLogin(new Request('https://lowwin.shop'+startPath),client),authorization=new URL(begin.headers.get('location')!),state=authorization.searchParams.get('state')!,cookie=begin.headers.get('set-cookie')!.split(';')[0];
  f.find.mockRejectedValueOnce(Object.assign(new Error('private database connection details'),{code:'P2021'}));
  const response=await finishTelegramBrowserLogin(new Request('https://lowwin.shop/api/auth/telegram/browser/callback?'+new URLSearchParams({state,code:'private-code'}),{headers:{cookie}}),client,vi.fn());
  expect(response.headers.get('location')).toContain('telegramLoginError=unavailable');expect(console.warn).toHaveBeenCalledWith('telegram_browser_login_rejected',{stage:'browser_binding',code:'unavailable',diagnostic:undefined,databaseCode:'P2021'});
  const logged=JSON.stringify(vi.mocked(console.warn).mock.calls);expect(logged).not.toContain('private database');expect(logged).not.toContain(cookie);expect(logged).not.toContain(state);
 });
});
