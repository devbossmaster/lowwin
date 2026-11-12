import {afterEach,beforeEach,describe,expect,it,vi,type MockInstance} from 'vitest';

const f=vi.hoisted(()=>({order:{} as Record<string,unknown>,lookup:vi.fn(),parse:vi.fn(),find:vi.fn(),events:vi.fn(),auditRead:vi.fn(),auditCreate:vi.fn(),transaction:vi.fn(),disconnect:vi.fn()}));
vi.mock('@next/env',()=>({default:{loadEnvConfig:vi.fn()}}));
vi.mock('dotenv/config',()=>({}));
vi.mock('@prisma/client',()=>({PrismaClient:class{chapaCheckout={findFirst:f.find,findUniqueOrThrow:f.find};chapaWebhookEvent={findMany:f.events};adminAudit={findUnique:f.auditRead,create:f.auditCreate};$transaction=f.transaction;$disconnect=f.disconnect}}));
vi.mock('../src/lib/database-config',()=>({runtimeDatabaseUrl:()=> 'postgresql://unused@127.0.0.1/operator_test'}));
vi.mock('../src/modules/payments/chapa-provider',()=>({chapaConfigurationFingerprint:()=> 'b'.repeat(64),chapaAvailability:()=>({configured:true,recoveryEnabled:true,enabled:false,mode:'test',credentialFingerprint:'b'.repeat(64)}),chapaTransport:{lookup:f.lookup},parseChapaEvidence:f.parse,isChapaHostedSessionReference:()=>false,ChapaProviderError:class extends Error{}}));
vi.mock('../src/modules/payments/chapa-metadata',()=>({matchesChapaMetadata:()=>true}));
vi.mock('../src/modules/payments/chapa-amount-diagnostic',()=>({chapaAmountDiagnostic:()=>({principalCents:'1000'})}));
vi.mock('../src/modules/payments/chapa-recovery-binding',()=>({recoveryAuthorizationAction:'CHAPA_CREDENTIAL_RECOVERY_AUTHORIZED',recoveryAuthorizationKey:()=> 'synthetic-recovery',recoveryBindingHash:()=> 'c'.repeat(64)}));

const id='fd855e36-f9b4-4777-b508-f8a2883d9346',merchant='LW123456789012345678',originalArgs=process.argv,originalExitCode=process.exitCode;
let stdout:MockInstance<typeof console.log>,stderr:MockInstance<typeof console.error>;
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();process.exitCode=undefined;
 f.order={id,userId:'synthetic-owner',flowVersion:3,initialization:{apiVersion:'v1'},mode:'test',status:'PENDING',reason:null,providerStatus:null,verificationState:'UNVERIFIED',creditJournalId:null,merchantReference:merchant,chapaReference:null,amountCents:1000n,currency:'ETB',credentialFingerprint:'a'.repeat(64),initializationErrorCode:null,initializationHttpStatus:null,nextCheckAt:new Date(0),leaseUntil:null,payerPhoneCipher:'private-payer-cipher'};
 f.find.mockImplementation(async()=>f.order);f.events.mockResolvedValue([]);f.auditRead.mockResolvedValue(null);f.disconnect.mockResolvedValue(undefined);f.transaction.mockRejectedValue(Error('Unexpected audit transaction'));
 const proof={merchantReference:merchant,chapaReference:'CHtestreference',amountCents:'1000',currency:'ETB',mode:'test',status:'SUCCESS',hash:'c'.repeat(64)};f.lookup.mockResolvedValue({status:'success',data:{}});f.parse.mockReturnValue(proof);
 stdout=vi.spyOn(console,'log').mockImplementation(()=>{});stderr=vi.spyOn(console,'error').mockImplementation(()=>{});vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No real provider HTTP is allowed'));
});
afterEach(()=>{process.argv=originalArgs;process.exitCode=originalExitCode;vi.restoreAllMocks()});

async function run(command:'diagnostic'|'recovery',confirm=false){
 process.argv=command==='diagnostic'?['node','check-chapa-checkout.ts','--checkout',id,'--provider']:['node','authorize-chapa-recovery.ts','--checkout',id,'--merchant',merchant,'--amount-cents','1000','--final-reference','CHtestreference',...(confirm?['--confirm']:[])];
 if(command==='diagnostic')await import('../scripts/check-chapa-checkout');else await import('../scripts/authorize-chapa-recovery');
 await vi.waitFor(()=>{expect(f.disconnect).toHaveBeenCalledOnce();expect(stdout.mock.calls.length+stderr.mock.calls.length).toBe(1)});
 return {output:stdout.mock.calls.length?JSON.parse(String(stdout.mock.calls[0][0])):null,error:stderr.mock.calls.length?JSON.parse(String(stderr.mock.calls[0][0])):null};
}

describe('operator commands do not reinterpret retired payments',()=>{
 it.each([{flowVersion:3,initialization:{}},{flowVersion:2,initialization:{apiVersion:'v1'}}])('skips a requested provider diagnostic for historical protocol %#',async marker=>{
  Object.assign(f.order,marker);const result=await run('diagnostic');expect(result.error).toBeNull();expect(result.output).toMatchObject({found:true,apiVersion:'legacy',unsupportedLegacy:true,status:'PENDING',creditApplied:false,credentialMatches:false,provider:{skipped:true,code:'LEGACY_PAYMENT_UNSUPPORTED'}});
  expect(f.lookup).not.toHaveBeenCalled();expect(f.parse).not.toHaveBeenCalled();expect(f.transaction).not.toHaveBeenCalled();expect(f.auditCreate).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('private-payer-cipher');
 });
 it.each([{flowVersion:3,initialization:{}},{flowVersion:2,initialization:{apiVersion:'v1'}}])('blocks even explicit recovery confirmation before lookup or audit for historical protocol %#',async marker=>{
  Object.assign(f.order,marker);const result=await run('recovery',true);expect(result.output).toBeNull();expect(result.error).toMatchObject({error:'RECOVERY_AUTHORIZATION_FAILED',message:'Historical payment is read-only. Provider recovery is unavailable for this retired protocol.'});
  expect(f.lookup).not.toHaveBeenCalled();expect(f.parse).not.toHaveBeenCalled();expect(f.auditRead).not.toHaveBeenCalled();expect(f.auditCreate).not.toHaveBeenCalled();expect(f.transaction).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('keeps the explicit v2 diagnostic available without applying a credit',async()=>{
  Object.assign(f.order,{flowVersion:4,initialization:{apiVersion:'v2'}});const result=await run('diagnostic');expect(result.error).toBeNull();expect(result.output).toMatchObject({apiVersion:'v2',unsupportedLegacy:false,status:'PENDING',creditApplied:false,provider:{evidenceValid:true,status:'SUCCESS'}});expect(f.lookup).toHaveBeenCalledExactlyOnceWith(merchant);expect(f.transaction).not.toHaveBeenCalled();expect(f.auditCreate).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('keeps reviewed v2 recovery inspection available without --confirm audit writes',async()=>{
  Object.assign(f.order,{flowVersion:2,initialization:{apiVersion:'v2'}});const result=await run('recovery');expect(result.error).toBeNull();expect(result.output).toMatchObject({reviewOnly:true,paymentVerified:true,authorizationRecorded:false,creditApplied:false});expect(f.lookup).toHaveBeenCalledExactlyOnceWith(merchant);expect(f.auditRead).toHaveBeenCalledOnce();expect(f.auditCreate).not.toHaveBeenCalled();expect(f.transaction).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
});
