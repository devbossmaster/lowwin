import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {PrismaClient} from '@prisma/client';
const f=vi.hoisted(()=>({contact:vi.fn(),bonus:vi.fn(),auth:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{telegramOwnContact:{findUnique:f.contact}}}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:f.auth}));
vi.mock('../src/modules/wallet/deposit-bonus',async original=>({...await original<typeof import('../src/modules/wallet/deposit-bonus')>(),getDepositBonusPolicy:f.bonus}));
import {chapaInlineTransport} from '../src/modules/payments/chapa-inline-provider';
import {chapaInlineConfig} from '../src/modules/payments/chapa-inline';
import {GET} from '../src/app/api/payments/chapa/inline/config/route';
import {PrivateApiError} from '../src/modules/auth/private-api';

const methods={status:'success',data:[{slug:'telebirr',name:'telebirr',can_process_payments:true,supported_currencies:{ETB:{countries:{ET:{is_enabled:true,min_amount:100,max_amount:1000000}}}}}]};
const bonus={configured:false,enabled:false,percent:10,minAmount:'100.00',maxBonus:null,validityDays:7,endsAt:null,version:0};
const db={telegramOwnContact:{findUnique:f.contact}} as unknown as PrismaClient;
let serial=0;
beforeEach(()=>{
 vi.clearAllMocks();f.contact.mockResolvedValue(null);f.bonus.mockResolvedValue(bonus);f.auth.mockResolvedValue('owned-user');
 const key='a'.repeat(32)+String(++serial);
 for(const [name,value] of Object.entries({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:55608/chapa_inline_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+key,CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+key,CHAPA_WEBHOOK_SECRET:'local-inline-webhook-secret-at-least-thirty-two-characters'}))vi.stubEnv(name,value);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()});
describe('owned Inline checkout configuration',()=>{
 it('returns the business minimum and truthful enabled merchant limits',async()=>{
  const provider=vi.spyOn(chapaInlineTransport,'methods').mockResolvedValue(methods);
  const config=await chapaInlineConfig(db,'owned-user');
  expect(config).toMatchObject({minTopup:'5.00',maxTopup:'43200.00',enabled:true,phone:null,methods:[{slug:'telebirr',minAmountCents:'100',maxAmountCents:'1000000'}]});
  expect(f.contact).toHaveBeenCalledWith({where:{userId:'owned-user'},select:{phoneCipher:true,botId:true,revokedAt:true}});expect(provider).toHaveBeenCalledOnce();
 });
 it('starts contact, bonus and provider reads together and reuses healthy merchant capabilities',async()=>{
  let contact!:(value:null)=>void,policy!:(value:typeof bonus)=>void,capability!:(value:typeof methods)=>void;
  f.contact.mockImplementation(()=>new Promise(resolve=>{contact=resolve}));f.bonus.mockImplementation(()=>new Promise(resolve=>{policy=resolve}));
  const provider=vi.spyOn(chapaInlineTransport,'methods').mockImplementation(()=>new Promise(resolve=>{capability=resolve}));
  const pending=chapaInlineConfig(db,'owned-user');expect(f.contact).toHaveBeenCalledOnce();expect(f.bonus).toHaveBeenCalledOnce();expect(provider).toHaveBeenCalledOnce();
  contact(null);policy(bonus);capability(methods);await pending;
  f.contact.mockResolvedValue(null);f.bonus.mockResolvedValue(bonus);await chapaInlineConfig(db,'another-owned-user');expect(provider).toHaveBeenCalledOnce();expect(f.contact).toHaveBeenLastCalledWith(expect.objectContaining({where:{userId:'another-owned-user'}}));
 });
 it('adds sanitized phase timings and private response headers',async()=>{
  vi.spyOn(chapaInlineTransport,'methods').mockResolvedValue(methods);const response=await GET(new Request('https://lowwin.test/api/payments/chapa/inline/config'));
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');
  const timing=response.headers.get('server-timing')!;for(const phase of ['auth','database','pricing','capabilities','total'])expect(timing).toContain(phase+';dur=');expect(timing).not.toMatch(/owned-user|CHAPA_TEST|phone|secret/);
 });
 it('never calls capabilities or account configuration for an unauthenticated request',async()=>{
  const provider=vi.spyOn(chapaInlineTransport,'methods');f.auth.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));const response=await GET(new Request('https://lowwin.test/api/payments/chapa/inline/config'));
  expect(response.status).toBe(401);expect(f.contact).not.toHaveBeenCalled();expect(f.bonus).not.toHaveBeenCalled();expect(provider).not.toHaveBeenCalled();
 });
 it('measures isolated cold/warm configuration with identical controlled data latencies',async()=>{
  const provider=vi.spyOn(chapaInlineTransport,'methods').mockImplementation(async()=>{await delay(60);return methods});f.contact.mockImplementation(async()=>{await delay(20);return null});f.bonus.mockImplementation(async()=>{await delay(25);return bonus});
  const start=performance.now();await chapaInlineConfig(db,'owned-user');const coldMs=performance.now()-start;
  const warmStart=performance.now();await chapaInlineConfig(db,'owned-user');const warmMs=performance.now()-warmStart;
  const evidence={kind:'isolated configuration with mocked provider/database delays; not live latency',controlledDelayMs:{provider:60,contact:20,bonus:25},coldMs,warmMs,providerRequests:provider.mock.calls.length,accountReads:f.contact.mock.calls.length,bonusReads:f.bonus.mock.calls.length};
  if(process.env.CHAPA_CONFIG_TIMING_OUT)writeFileSync(process.env.CHAPA_CONFIG_TIMING_OUT,JSON.stringify(evidence,null,2));
  expect(provider).toHaveBeenCalledOnce();expect(f.contact).toHaveBeenCalledTimes(2);expect(f.bonus).toHaveBeenCalledTimes(2);
 });
});
