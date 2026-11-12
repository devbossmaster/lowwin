import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ChapaCheckout,PrismaClient} from '@prisma/client';
import type {ChapaInlineTransport} from '../src/modules/payments/chapa-inline-provider';
import {createInlineCheckout,findInlineCheckoutByKey} from '../src/modules/payments/chapa-inline';

const spies=vi.hoisted(()=>({authorize:vi.fn(),eligible:vi.fn(),validateBatch:vi.fn(),verify:vi.fn(),get:vi.fn()}));
vi.mock('../src/modules/auth/own-contact',()=>({decryptPhone:()=> '251911652904',encryptPhone:()=> 'encrypted-payer',phoneHash:(value:string)=>'hash:'+value}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:async()=>true}));
vi.mock('../src/modules/auctions/maintenance',()=>({auctionMaintenance:async()=>false}));
vi.mock('../src/modules/auctions/batch',()=>({batchLines:(batch:{lines:unknown})=>batch.lines,ownBatch:(batch:any)=>({id:batch.id,quoteHash:batch.quoteHash,auctionSlug:batch.auctionSlug,feeVersion:batch.feeVersion,lines:batch.lines,totalCents:String(batch.totalCents)}),validateBatchInTransaction:spies.validateBatch}));
vi.mock('../src/modules/payments/chapa',()=>({eligible:spies.eligible,ownChapaCheckout:(order:unknown)=>order,getChapaCheckout:spies.get,verifyChapaCheckout:spies.verify}));

const key='04b7c915-8010-4ea0-86d6-8ca2ea3b181e',batchId='560e2a63-b907-49df-9828-39869b66cffc',quoteHash='a'.repeat(64);
const lines=[{position:0,number:'4.25',grossFee:'50.00',discount:'0.00',netFee:'50.00'},{position:1,number:'324.00',grossFee:'50.00',discount:'0.00',netFee:'50.00'}];
const bid={key,purpose:'BID',flow:'INLINE',paymentMethod:'telebirr',phone:'0911652904',batchId,quoteHash};
function fixture(){
 let order:ChapaCheckout|null=null,inTransaction=false;
 const batch={id:batchId,userId:'owner',quoteHash,status:'QUOTED',auctionId:1,auctionSlug:'test-auction',totalCents:10000n,grossCents:10000n,discountCents:0n,couponId:null,feeVersion:1,lines};
 const checkout={
  findUnique:vi.fn(async({where}:any)=>where.userId_key?order&&order.userId===where.userId_key.userId&&order.key===where.userId_key.key?order:null:where.batchId?order&&order.batchId===where.batchId?order:null:null),
  create:vi.fn(async({data}:any)=>{order={...data,creditJournalId:null,authorizationReference:null,providerRequestId:null,authType:null,checkoutUrl:null,providerStatus:null,verificationState:'UNVERIFIED',initializationErrorCode:null,initializationHttpStatus:null,createdAt:new Date()} as ChapaCheckout;return order}),
  updateManyAndReturn:vi.fn(async({data}:any)=>{order={...order!,...data};return [order]}),
  updateMany:vi.fn(async()=>({count:1})),
 };
 const transaction={chapaCheckout:checkout,bidBatchOrder:{findFirst:vi.fn(async()=>batch)},$queryRaw:vi.fn(async()=>[]),$executeRaw:vi.fn(async()=>1)};
 const db={...transaction,$transaction:vi.fn(async(operation:any)=>{inTransaction=true;try{return await operation(transaction)}finally{inTransaction=false}})} as unknown as PrismaClient;
 const methods=vi.fn(async()=>({status:'success',data:[{name:'telebirr',slug:'telebirr',can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:1000000,countries:{ET:{is_enabled:true,min_amount:100,max_amount:1000000}}}}}]}));
 const inline=vi.fn(async(input:any)=>{expect(inTransaction).toBe(false);expect(order).not.toBeNull();expect(order!.amountCents).toBe(BigInt(input.amountCents));expect(order!.merchantReference).toBe(input.merchantReference);return {status:'success',data:{auth_type:'USSD',chapa_reference:'CHowned-reference',payment_status:'PENDING',request_id:'request-owned',expires_at:new Date(Date.now()+300000).toISOString()}}});
 const transport={inline,methods,create:vi.fn(),lookup:vi.fn(),validate:vi.fn()} as unknown as ChapaInlineTransport;
 spies.get.mockImplementation(async()=>order);spies.verify.mockImplementation(async()=>order);spies.validateBatch.mockResolvedValue({totalCents:10000n,lines});
 return {db,transport,inline,checkout,batch,order:()=>order,changeOrder:(patch:Partial<ChapaCheckout>)=>{order={...order!,...patch}}};
}
beforeEach(()=>{
 vi.clearAllMocks();spies.eligible.mockResolvedValue({phoneCipher:'encrypted-contact',botId:'bot'});
 for(const [name,value] of Object.entries({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:55608/chapa_inline_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(32),CHAPA_WEBHOOK_SECRET:'local-inline-webhook-secret-at-least-thirty-two-characters'}))vi.stubEnv(name,value);
});
afterEach(()=>vi.unstubAllEnvs());

describe('owned v2 Inline creation boundary',()=>{
 it('commits exact quoted fees and immutable account/reference/key binding before HTTP',async()=>{
  const f=fixture(),result=await createInlineCheckout(f.db,'owner',bid,spies.authorize,f.transport);
  expect(spies.authorize).toHaveBeenCalledOnce();expect(spies.eligible).toHaveBeenCalledOnce();expect(spies.validateBatch).toHaveBeenCalledOnce();
  expect(f.inline).toHaveBeenCalledOnce();expect(f.inline.mock.calls[0][0]).toMatchObject({amountCents:'10000',phone:'251911652904',paymentMethod:'telebirr'});
  expect(result.order).toMatchObject({flowVersion:4,chargeType:'INLINE',amountCents:10000n,status:'AUTH_NEEDED',authorizationReference:'CHowned-reference',initialization:{apiVersion:'v2',flowVersion:4,flow:'INLINE',amountCents:'10000',publicKeyFingerprint:expect.stringMatching(/^[a-f0-9]{64}$/),idempotencyKey:expect.stringMatching(/^lowwin-inline:/)}});
  expect(f.order()!.merchantReference).toHaveLength(20);expect(f.order()!.amountCents).not.toBe(32825n);
 });
 it('returns the same accepted initialization for repeat Pay without dispatching twice',async()=>{
  const f=fixture();const first=await createInlineCheckout(f.db,'owner',bid,spies.authorize,f.transport),second=await createInlineCheckout(f.db,'owner',bid,spies.authorize,f.transport);
  expect(second.order.id).toBe(first.order.id);expect(f.checkout.create).toHaveBeenCalledOnce();expect(f.inline).toHaveBeenCalledOnce();
 });
 it('rejects changed payer details under the original key',async()=>{
  const f=fixture();await createInlineCheckout(f.db,'owner',bid,spies.authorize,f.transport);
  await expect(createInlineCheckout(f.db,'owner',{...bid,phone:'0911652905'},spies.authorize,f.transport)).rejects.toMatchObject({code:'KEY_REUSED'});expect(f.inline).toHaveBeenCalledOnce();
 });
 it('rejects changed quote pricing before persisting or initiating payment',async()=>{
  const f=fixture();spies.validateBatch.mockResolvedValue({totalCents:20000n,lines});
  await expect(createInlineCheckout(f.db,'owner',bid,spies.authorize,f.transport)).rejects.toMatchObject({code:'TERMS_CHANGED'});expect(f.checkout.create).not.toHaveBeenCalled();expect(f.inline).not.toHaveBeenCalled();
 });
 it('does not initialize invalid phones or provider-prefix mismatches',async()=>{
  const f=fixture();await expect(createInlineCheckout(f.db,'owner',{...bid,paymentMethod:'mpesa'},spies.authorize,f.transport)).rejects.toMatchObject({code:'INVALID_PHONE'});expect(f.checkout.create).not.toHaveBeenCalled();expect(f.inline).not.toHaveBeenCalled();
 });
 it('recovers the owned key read-only and returns the same not-found result for another account',async()=>{
  const f=fixture();await createInlineCheckout(f.db,'owner',bid,spies.authorize,f.transport);
  expect((await findInlineCheckoutByKey(f.db,'owner',key)).id).toBe(f.order()!.id);await expect(findInlineCheckoutByKey(f.db,'other',key)).rejects.toMatchObject({code:'NOT_FOUND'});expect(f.inline).toHaveBeenCalledOnce();
 });
 it('keeps a timed-out initialization attached to its saved original operation',async()=>{
  const f=fixture();f.inline.mockRejectedValueOnce(new TypeError('interrupted transport'));const result=await createInlineCheckout(f.db,'owner',bid,spies.authorize,f.transport);
  expect(result.order).toMatchObject({status:'PENDING',verificationState:'UNAVAILABLE',reason:'PROVIDER_CONFIRMATION_REQUIRED'});expect(f.checkout.create).toHaveBeenCalledOnce();expect(f.order()!.initialization).toHaveProperty('idempotencyKey');expect(f.inline).toHaveBeenCalledOnce();
 });
});
