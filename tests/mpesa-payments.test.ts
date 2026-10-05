import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {assess,candidate,depositBankSchema,providerReference,submitVerify,submitVerifyImage,type VerificationInput} from '../src/modules/payments/provider';
import {createIntent,fundingOptions} from '../src/modules/payments/service';
import {paymentAdminCommand,paymentAdminRead} from '../src/modules/payments/admin';

vi.mock('../src/modules/payments/activation',()=>({liveFundingConfigured:()=>true}));
vi.mock('../src/modules/admin/boundary',()=>({requireAdmin:vi.fn(async()=>({id:'fixture-owner',role:'OWNER',now:new Date()}))}));
const now=new Date('2026-10-05T09:00:00Z'),requestId=randomUUID();
const input:VerificationInput={bank:'mpesa',reference:'MPESA123456',account:'0711111111',expectedCents:null,minCents:100n,maxCents:100000n,createdAt:new Date(now.getTime()-60000),expiresAt:new Date(now.getTime()+60000),attemptKey:'stable-mpesa-attempt'};
const completed=(change:Record<string,unknown>={})=>({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'mpesa',status:'success',verified:true,amount:'30.27',transactionNumber:input.reference,receiverAccount:'251711111111',timestamp:now.toISOString(),...change}]});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs()});

describe('M-Pesa deposits',()=>{
 it.each(['mpesa123456','Transaction number: mpesa123456','M-Pesa MPESA123456 confirmed.','Reference: 1MPESA23456','https://m-pesabusiness.safaricom.et/api/receipt/getReceipt?trxNo=MPESA123456'])('extracts one transaction number from %s',text=>{
  expect(candidate('mpesa',text)).toBe(text.startsWith('Reference:')?'1MPESA23456':input.reference);
 });
 it.each(['1234567890','MPESAONLY','Telebirr Transaction number: MPESA123456','https://m-pesabusiness.safaricom.et.evil.test/api/receipt/getReceipt?trxNo=MPESA123456','http://m-pesabusiness.safaricom.et/api/receipt/getReceipt?trxNo=MPESA123456','https://m-pesabusiness.safaricom.et/api/receipt/getReceipt?trxNo=MPESA123456&trxNo=OTHER12345','https://m-pesabusiness.safaricom.et/api/receipt/getReceipt?trxNo=MPESA123456&url=https://evil.test','MPESA123456 confirmed. OTHER12345 confirmed.'])('rejects ambiguous or unsupported input %s',text=>expect(()=>candidate('mpesa',text)).toThrow());
 it('requires full matching evidence and normalizes the Ethiopian wallet number',()=>{
  expect(assess(completed(),input,now)).toMatchObject({matched:true,code:'VERIFIED',evidence:{amountCents:'3027',currency:'ETB',currencySource:'channel_policy'}});
  expect(providerReference(completed().data[0],'mpesa')).toBe(input.reference);
 });
 it.each([
  [{receiverAccount:'251722222222'},'RECEIVER_MISMATCH'],
  [{receiverAccount:'2517****1111'},'RECEIVER_UNPROVEN'],
  [{transactionNumber:'OTHER12345'},'REFERENCE_MISMATCH'],
  [{bank:'telebirr'},'UNCONFIRMED'],
  [{amount:'1000.01'},'AMOUNT_MISMATCH'],
  [{amount:undefined},'INCOMPLETE_EVIDENCE'],
  [{timestamp:undefined},'DATE_UNPROVEN'],
  [{timestamp:'2025-01-01T00:00:00Z'},'DATE_MISMATCH'],
 ] as const)('does not credit invalid evidence %j',(change,code)=>expect(assess(completed(change),input,now)).toMatchObject({matched:false,code}));
 it('accepts a provider-approved masked match only to the frozen M-Pesa account',()=>{
  const change={receiverAccount:'2517****1111',settlementAccountMatch:{matched:true,matchType:'masked_pattern',ambiguous:false,matchedSettlementAccount:input.account,bank:'mpesa'}};
  expect(assess(completed(change),input,now)).toMatchObject({matched:true,code:'VERIFIED'});
  expect(assess(completed({...change,settlementAccountMatch:{...change.settlementAccountMatch,bank:'telebirr'}}),input,now).matched).toBe(false);
 });
 it('submits the wallet transaction number with the frozen receiver and a stable key',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','fixture-only');
  const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued'},data:[]},{status:202}));vi.stubGlobal('fetch',fetcher);
  expect(await submitVerify(input)).toMatchObject({code:'PROCESSING',requestId,matched:false});
  const [url,options]=fetcher.mock.calls[0];
  expect(url).toBe('https://verify.et/api/verify?waitMs=5000');
  expect(options.headers).toMatchObject({'Idempotency-Key':input.attemptKey});
  expect(JSON.parse(options.body)).toEqual({bank:'mpesa',transactionNumber:input.reference,settlementAccount:input.account});
 });
 it('sends M-Pesa receipt images to Verify.et without changing the receiver or key',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','fixture-only');
  const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued'},data:[]},{status:202}));vi.stubGlobal('fetch',fetcher);
  expect(await submitVerifyImage({...input,image:Buffer.from('fixture-image'),mime:'image/png'})).toMatchObject({verification:{code:'PROCESSING',matched:false}});
  const options=fetcher.mock.calls[0][1],form=options.body as FormData;
  expect(options.headers).toMatchObject({'Idempotency-Key':input.attemptKey});expect(options.headers).not.toHaveProperty('Content-Type');
  expect(form.get('bank')).toBe('mpesa');expect(form.get('settlementAccount')).toBe(input.account);expect(form.get('image')).toBeInstanceOf(Blob);
 });
 it('lists Telebirr, CBE and M-Pesa with their own receiving accounts',async()=>{
  const numbers={telebirr:'0911111111',cbe:'1000303997441',mpesa:'0711111111'};
  const findFirst=vi.fn(async({where}:{where:{channel:keyof typeof numbers}})=>({id:randomUUID(),channel:where.channel,enabled:true,version:1,account:numbers[where.channel],accountName:'Fixture receiver',pointsNumerator:1n,centsDenominator:100n,minCents:100n,maxCents:100000n,terms:'Fixture only'}));
  const options=await fundingOptions({paymentPolicy:{findFirst}} as unknown as PrismaClient);
  expect(options.accounts.map(account=>account.id)).toEqual(['telebirr','cbe','mpesa']);expect(options.accounts.map(account=>account.name)).toEqual(['Telebirr','CBE','M-Pesa']);
  expect(options.accounts.map(account=>account.number)).toEqual(Object.values(numbers));
  expect(findFirst.mock.calls.map(([query])=>query.where.channel)).toEqual(['telebirr','cbe','mpesa']);
 });
 it.each(['telebirr','cbe','mpesa'])('accepts %s for new deposits at the public input boundary',async channel=>{
  const transaction=vi.fn(async()=>{throw Error('entered guarded transaction')});
  expect(depositBankSchema.safeParse(channel).success).toBe(true);
  await expect(createIntent({$transaction:transaction} as unknown as PrismaClient,'fixture-user',{channel,key:randomUUID(),policyId:randomUUID()},true)).rejects.toThrow('entered guarded transaction');
  expect(transaction).toHaveBeenCalledTimes(1);
 });
 it('rejects unsupported deposit channels before any database mutation',async()=>{
  const transaction=vi.fn(),client={$transaction:transaction} as unknown as PrismaClient;
  expect(depositBankSchema.safeParse('unsupported').success).toBe(false);
  await expect(createIntent(client,'fixture-user',{channel:'unsupported',key:randomUUID(),policyId:randomUUID()},true)).rejects.toThrow();expect(transaction).not.toHaveBeenCalled();
 });
 it.each(['telebirr','cbe','mpesa'])('rejects a customer amount override when preparing a %s receipt deposit',async channel=>{
  const transaction=vi.fn(),client={$transaction:transaction} as unknown as PrismaClient;
  await expect(createIntent(client,'fixture-user',{channel,key:randomUUID(),policyId:randomUUID(),amountCents:'999999'},true)).rejects.toThrow();
  expect(transaction).not.toHaveBeenCalled();
 });
 it('exposes all three receiving-account configurations to the Owner',async()=>{
  const findFirst=vi.fn(async()=>null);
  await paymentAdminRead({paymentPolicy:{findFirst}} as unknown as PrismaClient,new Headers(),['settings'],new URLSearchParams());
  expect(findFirst.mock.calls).toEqual(['telebirr','cbe','mpesa'].map(channel=>[{where:{channel},orderBy:{version:'desc'}}]));
 });
 it.each([['cbe','1000303997441'],['telebirr','0911111111'],['mpesa','0711111111']])('allows an Owner to review the correct %s receiving account',async(channel,account)=>{
  const client={paymentPolicy:{findFirst:vi.fn(async()=>null)}} as unknown as PrismaClient;
  const result=await paymentAdminCommand(client,new Headers(),'preview-policy',{key:randomUUID(),channel,version:0,enabled:true,account,accountName:'Fixture receiver',pointsNumerator:'1',centsDenominator:'100',minCents:'100',maxCents:'100000',accountConfirmed:true});
  expect(result).toMatchObject({proposed:{channel,account,version:1}});
 });
 it.each(['telebirr','mpesa'])('rejects a bank account used as a %s wallet number',async channel=>{
  const findFirst=vi.fn(),client={paymentPolicy:{findFirst}} as unknown as PrismaClient;
  await expect(paymentAdminCommand(client,new Headers(),'preview-policy',{key:randomUUID(),channel,version:0,enabled:true,account:'1000303997441',accountName:'Fixture receiver',pointsNumerator:'1',centsDenominator:'100',minCents:'100',maxCents:'100000',accountConfirmed:true})).rejects.toThrow('wallet phone number');
  expect(findFirst).not.toHaveBeenCalled();
 });
});
