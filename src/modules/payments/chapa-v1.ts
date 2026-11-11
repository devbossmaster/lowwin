import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {normalizePaymentPhone,paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {decryptPhone,encryptPhone,phoneHash} from '../auth/own-contact';
import {batchLines,ownBatch,validateBatchInTransaction} from '../auctions/batch';
import {auctionMaintenance} from '../auctions/maintenance';
import {eligible,getChapaCheckout,ownChapaCheckout,verifyChapaCheckout} from './chapa';
import {ChapaError,chapaHash} from './chapa-provider';
import {chapaV1Availability,chapaV1Methods,chapaV1Transport,isV1Checkout,requireChapaV1,safeV1CheckoutUrl,type ChapaV1Transport} from './chapa-v1-provider';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {measureChapa} from './chapa-timing';

type Authorize=(tx:Prisma.TransactionClient)=>Promise<void>;
const common={key:z.string().uuid(),flow:z.enum(['INLINE','HOSTED']),paymentMethod:z.enum(['telebirr','cbebirr','mpesa','ebirr','cbe-bank']),phone:z.string().min(9).max(40)};
const input=z.discriminatedUnion('purpose',[z.object({...common,purpose:z.literal('BID'),batchId:z.string().uuid(),quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({...common,purpose:z.literal('TOP_UP'),amount:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/)}).strict()]);
export const LOCAL_CBE_GUIDE='/video/cbe-bank-payment.mp4';
export function safeCbeGuideUrl(raw=process.env.CHAPA_V1_CBE_GUIDE_URL){try{if(!raw||raw===LOCAL_CBE_GUIDE)return LOCAL_CBE_GUIDE;const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
export async function chapaV1Config(client:PrismaClient,userId:string){
 const health=chapaV1Availability(),contact=await client.telegramOwnContact.findUnique({where:{userId},select:{phoneCipher:true,botId:true,revokedAt:true}});let phone:string|null=null;try{if(contact&&!contact.revokedAt)phone=decryptPhone(contact.phoneCipher,contact.botId)}catch{}
 return {...health,credentialFingerprint:undefined,minTopup:'1.00',maxTopup:'43200.00',methods:chapaV1Methods(),phone,cbeBankEnabled:health.enabled&&process.env.CHAPA_V1_CBE_BANK_ENABLED==='true',cbeGuideUrl:safeCbeGuideUrl()};
}
/** A lost preparation response can be recovered by its original owned command
 * key. This lookup cannot initialize the SDK, call Chapa or change money. */
export async function findV1CheckoutByKey(client:PrismaClient,userId:string,key:string){
 const order=await client.chapaCheckout.findUnique({where:{userId_key:{userId,key:z.string().uuid().parse(key)}}});
 if(!order||!isV1Checkout(order))throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 return ownChapaCheckout(order);
}
/** Immutable owned principal and tx_ref are durable before the public SDK may
 * start. The same key never issues another SDK initialization configuration. */
export async function createV1Checkout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaV1Transport=chapaV1Transport){
 const health=requireChapaV1(),body=input.parse(raw),phone=normalizePaymentPhone(body.phone),problem=paymentPhoneProblem(body.phone,body.paymentMethod);
 if(!phone||problem)throw new ChapaError(422,'INVALID_PHONE',paymentPhoneProblemMessage(problem??'invalid'));
 if(body.flow==='HOSTED'?(body.paymentMethod!=='cbe-bank'||process.env.CHAPA_V1_CBE_BANK_ENABLED!=='true'):body.paymentMethod==='cbe-bank'||!chapaV1Methods().some(m=>m.slug===body.paymentMethod))throw new ChapaError(422,'METHOD_UNAVAILABLE','Choose an enabled payment method.');
 const requestHash=chapaHash(JSON.stringify({...body,phone:phoneHash(`+${phone}`)}));
 const prepared=await measureChapa('prepare',()=>client.$transaction(async tx=>{
  if(reauthorize)await reauthorize(tx);
  const previous=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});
  if(previous){if(!isV1Checkout(previous)||previous.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Keep the original payment details.');return {created:false,order:previous}}
  if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused. Existing payments can still be checked.');
  if(body.purpose==='BID')await tx.$queryRaw`SELECT a.id FROM "Auction" a JOIN "BidBatchOrder" b ON b."auctionId"=a.id WHERE b.id=${body.batchId} AND b."userId"=${userId} FOR UPDATE OF a`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
  const contact=await eligible(tx,userId),replay=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});
  if(replay){if(!isV1Checkout(replay)||replay.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Keep the original payment details.');return {created:false,order:replay}}
  if(!await allowIdentityRequest(tx,'chapa-v1-create',userId,24,3600000))throw new ChapaError(429,'RATE_LIMITED','Check Transactions before trying another payment.');
  const batch=body.purpose==='BID'?await tx.bidBatchOrder.findFirst({where:{id:body.batchId,userId}}):null;
  if(body.purpose==='BID'){
   if(!batch||batch.quoteHash!==body.quoteHash||batch.status!=='QUOTED')throw new ChapaError(409,'TERMS_CHANGED','Review your bid quote again.');
   if(await tx.chapaCheckout.findUnique({where:{batchId:batch.id}}))throw new ChapaError(409,'PAYMENT_STARTED','Check the existing payment for this selection.');
   const priced=await validateBatchInTransaction(tx,userId,batch.auctionSlug,batchLines(batch).map(l=>l.number),batch.feeVersion,batch.couponId??undefined);
   if(priced.totalCents!==batch.totalCents||JSON.stringify(priced.lines)!==JSON.stringify(batchLines(batch)))throw new ChapaError(409,'TERMS_CHANGED','The quote changed. Review before paying.');
  }
  const amountCents=batch?.totalCents??etbToCents(body.purpose==='TOP_UP'?body.amount:'0');
  if(amountCents<100n||amountCents>4320000n)throw new ChapaError(422,'INVALID_AMOUNT','Pay between 1.00 and 43,200.00 ETB.');
  const current=requireChapaV1();if(current.mode!==health.mode||current.credentialFingerprint!==health.credentialFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Reload payment options before paying.');
  const id=randomUUID(),merchantReference=`LW${randomBytes(9).toString('hex')}`,initialization={apiVersion:'v1',flow:body.flow,amountCents:String(amountCents),merchantReference,paymentMethod:body.paymentMethod,payerPhoneHash:phoneHash(`+${phone}`),...(batch?{batch:ownBatch(batch)}:{})};
  const order=await tx.chapaCheckout.create({data:{id,userId,key:body.key,requestHash,purpose:body.purpose,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,initialization:JSON.parse(JSON.stringify(initialization)),chargeType:body.flow,flowVersion:3,batchId:batch?.id,payerPhoneCipher:encryptPhone(phone,contact.botId),phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,merchantReference,amountCents,currency:'ETB',paymentMethod:body.paymentMethod,auctionId:batch?.auctionId,auctionSlug:batch?.auctionSlug,bidNumber:batch?new Prisma.Decimal(batchLines(batch)[0].number):null,feeVersion:batch?.feeVersion,grossFee:batch?new Prisma.Decimal(centsToEtb(batch.grossCents)):null,discountPoints:batch?new Prisma.Decimal(centsToEtb(batch.discountCents)):new Prisma.Decimal(0),couponId:batch?.couponId,status:'PENDING',reason:'AWAITING_PROVIDER',expiresAt:new Date(Date.now()+86400000),nextCheckAt:new Date(Date.now()+5000),reconcileUntil:new Date(Date.now()+30*86400000),...(body.flow==='HOSTED'?{leaseUntil:new Date(Date.now()+45000)}:{})}});
  return {created:true,order};
 },PAYMENT_TRANSACTION_OPTIONS));
 if(!prepared.created)return {order:await verifyChapaCheckout(client,prepared.order.id,userId,reauthorize,transport===chapaV1Transport?undefined:{create:async()=>null,methods:async()=>null,lookup:transport.lookup},true)};
 if(body.flow==='INLINE')return {order:ownChapaCheckout(prepared.order),inline:{publicKey:process.env.CHAPA_V1_PUBLIC_KEY!,txRef:prepared.order.merchantReference,amount:centsToEtb(prepared.order.amountCents),currency:'ETB' as const,phone:`0${phone.slice(3)}`,paymentMethod:body.paymentMethod}};
 // v1 does not document a write idempotency key. Dispatch once only. A lost
 // response reconciles tx_ref instead of blindly initializing the charge again.
 try{
  const result=await transport.initialize({txRef:prepared.order.merchantReference,amountCents:String(prepared.order.amountCents),phone:`0${phone.slice(3)}`,returnUrl:new URL(`/payments/chapa/return?checkout=${prepared.order.id}`,process.env.MINI_APP_URL).href,callbackUrl:new URL(`/api/payments/chapa/v1/callback?checkout=${prepared.order.id}`,process.env.MINI_APP_URL).href}),p=z.object({status:z.literal('success'),data:z.object({checkout_url:z.string()})}).safeParse(result),checkoutUrl=p.success?safeV1CheckoutUrl(p.data.data.checkout_url):null;
  if(!checkoutUrl)throw Error('Unconfirmed initialization');
  await client.chapaCheckout.updateMany({where:{id:prepared.order.id,creditJournalId:null,checkoutUrl:null},data:{checkoutUrl,leaseUntil:null,reason:'AWAITING_PROVIDER',nextCheckAt:new Date()}});
 }catch{await client.chapaCheckout.updateMany({where:{id:prepared.order.id,creditJournalId:null,checkoutUrl:null},data:{leaseUntil:null,reason:'PROVIDER_CONFIRMATION_REQUIRED',verificationState:'UNAVAILABLE',nextCheckAt:new Date(Date.now()+30000)}})}
 return {order:await getChapaCheckout(client,userId,prepared.order.id)};
}
export async function reconcileV1Checkouts(client:PrismaClient,limit=10){const health=chapaV1Availability();if(!health.recoveryEnabled)return {checked:0};const rows=await client.chapaCheckout.findMany({where:{flowVersion:3,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,creditJournalId:null,reconcileUntil:{gt:new Date()},nextCheckAt:{lte:new Date()},attempts:{lt:500},status:{in:['SUBMITTING','PENDING','AUTH_NEEDED','VERIFYING','NEEDS_REVIEW']}},orderBy:[{nextCheckAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit)),select:{id:true}});let checked=0;for(const row of rows){try{await verifyChapaCheckout(client,row.id);checked++}catch{}}return {checked}}
