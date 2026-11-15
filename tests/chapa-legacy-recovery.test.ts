import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Prisma,type ChapaCheckout,type PrismaClient} from '@prisma/client';
import {approvedLegacyRecoveryBinding,chapaLegacyRecoveryAvailability,createLegacyChapaRecoveryTransport,isLegacyChapaCheckout,legacyChapaConfigurationFingerprint,legacyChapaRecoveryAvailable,legacyChapaRecoveryBindings,legacyRecoveryAuthorizationAction,legacyRecoveryAuthorizationKey,parseLegacyChapaEvidence} from '../src/modules/payments/chapa-legacy-recovery';
import {recoveryBindingHash,type ChapaRecoveryBinding} from '../src/modules/payments/chapa-recovery-binding';
import {ownChapaCheckout,verifyChapaCheckout} from '../src/modules/payments/chapa';
import type {ChapaTransport} from '../src/modules/payments/chapa-provider';

const environment=(patch:Record<string,string|undefined>={})=>({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local:local@127.0.0.1:5432/legacy_recovery_test',CHAPA_SCHEMA_READY:'true',CHAPA_V1_MODE:'test',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40),CHAPA_V1_RECOVERY_ENABLED:'true',...patch});
const evidence=(change:Record<string,unknown>={})=>({status:'success',data:{tx_ref:'LWoriginalpayment',reference:'CHoriginalpayment',amount:'25.50',currency:'ETB',status:'success',mode:'test',charge:'0.64',method:'telebirr',...change}});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('original-v1 recovery configuration and money units',()=>{
 it('requires explicit original-version credentials without enabling creation',()=>{
  expect(chapaLegacyRecoveryAvailability(environment())).toMatchObject({configured:true,recoveryEnabled:true,mode:'test'});
  for(const patch of [{CHAPA_V1_SECRET_KEY:undefined,CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'x'.repeat(40)},{CHAPA_V1_SECRET_KEY:'CHAPA_TEST_'+'x'.repeat(40)},{CHAPA_V1_MODE:undefined},{CHAPA_V1_MODE:'invalid'},{CHAPA_SCHEMA_READY:'false'},{CHAPA_V1_BASE_URL:'https://untrusted.test'},{APP_ENV:'production'},{DATABASE_URL:'postgresql://local:local@remote.test/test'}])expect(chapaLegacyRecoveryAvailability(environment(patch)).recoveryEnabled).toBe(false);
  expect(chapaLegacyRecoveryAvailability(environment({CHAPA_V1_RECOVERY_ENABLED:'false',CHAPA_V1_ENABLED:'true'}))).toMatchObject({configured:true,recoveryEnabled:false});
 });
 it('isolates the exact historical origin, key and mode',()=>{
  const env=environment(),fingerprint=legacyChapaConfigurationFingerprint(env)!;
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(fingerprint).not.toContain(env.CHAPA_V1_SECRET_KEY);
  for(const patch of [{CHAPA_V1_BASE_URL:'https://api.chapa.global'},{CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'b'.repeat(40)}])expect(legacyChapaConfigurationFingerprint({...env,...patch})).not.toBe(fingerprint);
  const original={flowVersion:3,initialization:{apiVersion:'v1'},mode:'test',credentialFingerprint:fingerprint};expect(legacyChapaRecoveryAvailable(original,env)).toBe(true);
  for(const patch of [{mode:'live'},{credentialFingerprint:'f'.repeat(64)},{flowVersion:4,initialization:{apiVersion:'v2'}}])expect(legacyChapaRecoveryAvailable({...original,...patch},env)).toBe(false);
  expect(isLegacyChapaCheckout({flowVersion:4,initialization:{apiVersion:'v2'}})).toBe(false);
 });
 it('converts original major ETB units once and requires complete private success',()=>{
  expect(parseLegacyChapaEvidence(evidence())).toMatchObject({amountCents:'2550',serviceFeeCents:'64',status:'SUCCESS',mode:'test',merchantReference:'LWoriginalpayment',chapaReference:'CHoriginalpayment',paymentMethod:'telebirr'});
  expect(parseLegacyChapaEvidence(evidence({amount:25.5}))).toMatchObject({amountCents:'2550'});
  expect(parseLegacyChapaEvidence(evidence({amount:2550}))).toMatchObject({amountCents:'255000'});
  for(const change of [{amount:'25.501'},{amount:'025.50'},{amount:-1},{amount:Number.MAX_SAFE_INTEGER+1},{currency:'USD'},{mode:undefined},{mode:'unknown'},{tx_ref:''},{reference:null},{status:'SUCCESS'}])expect(parseLegacyChapaEvidence(evidence(change))).toBeNull();
  expect(parseLegacyChapaEvidence({...evidence(),status:'pending'})).toBeNull();
  for(const status of ['pending','failed','cancelled'])expect(parseLegacyChapaEvidence(evidence({status,reference:null}))?.status).toBe(status.toUpperCase());
 });
});

describe('recovery-only original-v1 transport',()=>{
 it('performs only the original private GET without following redirects or shared caching',async()=>{
  const env=environment(),fetcher=vi.fn(async()=>Response.json(evidence())),transport=createLegacyChapaRecoveryTransport({env,fetcher});
  expect(await transport.lookup('LWoriginalpayment')).toEqual(evidence());
  expect(fetcher).toHaveBeenCalledWith('https://api.chapa.co/v1/transaction/verify/LWoriginalpayment',expect.objectContaining({method:'GET',headers:{Authorization:`Bearer ${env.CHAPA_V1_SECRET_KEY}`},cache:'no-store',redirect:'error'}));
  await expect(transport.create({} as never)).rejects.toMatchObject({code:'LEGACY_CREATION_DISABLED'});await expect(transport.methods()).rejects.toMatchObject({code:'LEGACY_CREATION_DISABLED'});expect(fetcher).toHaveBeenCalledOnce();
 });
 it('cannot accidentally send a v2 key, malformed reference or disabled recovery request',async()=>{
  const fetcher=vi.fn(async()=>Response.json(evidence()));
  for(const env of [environment({CHAPA_V1_SECRET_KEY:'CHAPA_TEST_'+'x'.repeat(40)}),environment({CHAPA_V1_RECOVERY_ENABLED:'false'})])await expect(createLegacyChapaRecoveryTransport({env,fetcher}).lookup('LWoriginalpayment')).rejects.toMatchObject({code:'LEGACY_RECOVERY_UNAVAILABLE'});
  await expect(createLegacyChapaRecoveryTransport({env:environment(),fetcher}).lookup('../another')).rejects.toMatchObject({code:'INVALID_PAYMENT'});expect(fetcher).not.toHaveBeenCalled();
 });
 it('keeps unknown requests and absent references unresolved rather than inventing failure',async()=>{
  await expect(createLegacyChapaRecoveryTransport({env:environment(),fetcher:vi.fn(async()=>{throw new TypeError('disconnected')})}).lookup('LWoriginalpayment')).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  await expect(createLegacyChapaRecoveryTransport({env:environment(),fetcher:vi.fn(async()=>Response.json({status:'failed'},{status:404}))}).lookup('LWoriginalpayment')).rejects.toMatchObject({providerCode:'NOT_FOUND'});
  for(const response of [()=>new Response('malformed'),()=>new Response('x'.repeat(65537))])await expect(createLegacyChapaRecoveryTransport({env:environment(),fetcher:vi.fn(async()=>response())}).lookup('LWoriginalpayment')).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 });
});

describe('bounded original-version recovery binding',()=>{
 function fixture(){const env={...environment(),CHAPA_V1_RECOVERY_BINDINGS:''},order={id:randomUUID(),mode:'test',credentialFingerprint:'b'.repeat(64),requestHash:'c'.repeat(64),merchantReference:'LWoriginalpayment',amountCents:2550n,currency:'ETB'},binding:ChapaRecoveryBinding={checkoutId:order.id,mode:'test',fromFingerprint:order.credentialFingerprint,toFingerprint:legacyChapaConfigurationFingerprint(env)!,requestHash:order.requestHash,merchantReference:order.merchantReference,amountCents:'2550',currency:'ETB',finalReference:'CHoriginalpayment',expiresAt:new Date(Date.now()+3600000).toISOString()};env.CHAPA_V1_RECOVERY_BINDINGS=JSON.stringify([binding]);return {env,order,binding}}
 it('requires a separate original-version audited per-attempt authorization',async()=>{
  const {env,order,binding}=fixture(),audit={action:legacyRecoveryAuthorizationAction,target:order.id,requestHash:recoveryBindingHash(binding),details:{binding},createdAt:new Date()},findUnique=vi.fn(async()=>audit as typeof audit|null),client={adminAudit:{findUnique}} as unknown as PrismaClient;
  expect(await approvedLegacyRecoveryBinding(client,order,env)).toEqual(binding);expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{operationKey:legacyRecoveryAuthorizationKey(binding)}}));
  for(const change of [{id:randomUUID()},{mode:'live'},{amountCents:2551n},{merchantReference:'other'},{requestHash:'d'.repeat(64)}])expect(await approvedLegacyRecoveryBinding(client,{...order,...change},env)).toBeNull();
  findUnique.mockResolvedValueOnce({...audit,action:'CHAPA_CREDENTIAL_RECOVERY_AUTHORIZED'});expect(await approvedLegacyRecoveryBinding(client,order,env)).toBeNull();
  findUnique.mockResolvedValueOnce(null);expect(await approvedLegacyRecoveryBinding(client,order,env)).toBeNull();
  expect(legacyChapaRecoveryBindings({...env,CHAPA_V1_RECOVERY_BINDINGS:undefined,CHAPA_RECOVERY_BINDINGS:JSON.stringify([binding])})).toEqual([]);
 });
 it('fails closed for expired, over-broad, wrong-key and excessive bindings',()=>{
  const {env,binding}=fixture();for(const value of ['invalid','{}',JSON.stringify([{...binding,extra:true}]),JSON.stringify([{...binding,expiresAt:new Date(Date.now()-1).toISOString()}]),JSON.stringify([{...binding,expiresAt:new Date(Date.now()+172800000).toISOString()}]),JSON.stringify([{...binding,toFingerprint:'f'.repeat(64)}]),JSON.stringify(Array(21).fill(binding))])expect(legacyChapaRecoveryBindings({...env,CHAPA_V1_RECOVERY_BINDINGS:value})).toEqual([]);
 });
});

describe('original-v1 verification cannot use the active v2 transport',()=>{
 function fixture(){for(const [name,value] of Object.entries(environment()))vi.stubEnv(name,value!);const saved={id:randomUUID(),userId:'owner',flowVersion:3,initialization:{apiVersion:'v1'},mode:'test',credentialFingerprint:legacyChapaConfigurationFingerprint()!,amountCents:2550n,currency:'ETB',status:'PENDING',purpose:'TOP_UP',merchantReference:'LWoriginalpayment',creditJournalId:null,paymentMethod:'telebirr',nextCheckAt:new Date(0),leaseUntil:null,chapaReference:null,discountPoints:new Prisma.Decimal(0),createdAt:new Date(),updatedAt:new Date(),expiresAt:new Date(Date.now()+1000),verificationState:'UNVERIFIED'} as unknown as ChapaCheckout;return saved}
 it('exposes recovery only for the owned historical credential binding',async()=>{
  const saved=fixture();expect(ownChapaCheckout(saved)).toMatchObject({apiVersion:'legacy',unsupportedLegacy:false,legacyRecoveryAvailable:true,amount:'25.50'});
  const client={chapaCheckout:{findFirst:vi.fn(async()=>saved)}} as unknown as PrismaClient,transport={lookup:vi.fn(),create:vi.fn(),methods:vi.fn()} as unknown as ChapaTransport;
  await expect(verifyChapaCheckout(client,saved.id,saved.userId,undefined,transport)).rejects.toMatchObject({code:'CONFIGURATION_CHANGED'});expect(transport.lookup).not.toHaveBeenCalled();
  expect(ownChapaCheckout({...saved,credentialFingerprint:'f'.repeat(64)})).toMatchObject({legacyRecoveryAvailable:false,status:'PENDING'});
 });
 it.each([{amount:'2550'},{tx_ref:'anotherReference'},{mode:'live'}])('rejects original evidence mismatch %j without ledger work',async change=>{
  const saved=fixture(),updateMany=vi.fn(async({data}:{data:Record<string,unknown>})=>{Object.assign(saved,data);return {count:1}}),tx={chapaCheckout:{updateMany}},client={chapaCheckout:{findFirst:vi.fn(async()=>saved),updateMany},$transaction:vi.fn(async(fn:(tx:unknown)=>unknown)=>fn(tx))} as unknown as PrismaClient;
  const transport=createLegacyChapaRecoveryTransport({env:environment(),fetcher:vi.fn(async()=>Response.json(evidence(change)))});
  expect(await verifyChapaCheckout(client,saved.id,saved.userId,undefined,transport)).toMatchObject({status:'NEEDS_REVIEW',verificationState:'MISMATCH',reason:'EVIDENCE_MISMATCH'});expect(client.$transaction).toHaveBeenCalledOnce();expect(saved.creditJournalId).toBeNull();
 });
});
