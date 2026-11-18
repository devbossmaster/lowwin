import type {Prisma} from '@prisma/client';
import {getCountedMiniSession,getMiniSession,localMiniPreview} from '../auth/mini-access';
import {contactBotId} from '../auth/own-contact';
import {runAtomicCashWalletCommand} from '../auctions/wallet-cash-command';
import {limitUserMutation,mutationRateError,PrivateApiError} from '../auth/private-api';
import {measureChapa} from './chapa-timing';
import {prepareAtomicDirectBid} from './chapa-direct-bid-prepare';
import {prepareAtomicDirectTopUp} from './chapa-direct-topup-prepare';
import {authorizeBidBatchQuote,authorizeCurrentDirectCreation,authorizeWalletBatch,type PaymentSessionAuthorizer} from './creation-eligibility';
export type {PaymentSessionAuthorizer} from './creation-eligibility';

type PaymentIdentity=NonNullable<Awaited<ReturnType<typeof getMiniSession>>>;
async function paymentIdentity(request:Request){
 const current=await measureChapa('auth_session',()=>getMiniSession(request.headers));
 if(!current)throw new PrivateApiError(401,'Sign in through Telegram.');
 return current;
}

// Validate the signed cookie before opening a money transaction. Do not build
// a Better Auth adapter or refresh a session inside that transaction. Instead,
// re-read the authenticated session and its current binding in one DB query.
function paymentSession(request:Request,current:PaymentIdentity,directTopUpReady=false){
 const preview=current.user.id==='lowin-local-test-user'&&localMiniPreview(request.headers);
 const telegramId=current.telegramId;
 if(!preview&&!telegramId)throw new PrivateApiError(401,'Sign in through Telegram.');
 const botId=preview?null:contactBotId();
 const reauthorize:PaymentSessionAuthorizer=async(tx:Prisma.TransactionClient)=>{
  const valid=await tx.session.findFirst({where:{
   id:current.session.id,token:current.session.token,userId:current.user.id,expiresAt:{gt:new Date()},
   ...(!preview?{telegramLaunchId:telegramId,telegramAuthSource:current.session.telegramAuthSource,user:{is:{telegramId,staffMember:{is:null},ownContact:{is:{telegramId:telegramId!,botId:botId!,revokedAt:null}}}}}:{}),
  },select:{id:true}});
  if(!valid)throw new PrivateApiError(401,'Sign in through Telegram.');
 };
 if(!preview){
  const binding={sessionId:current.session.id,sessionToken:current.session.token,userId:current.user.id,telegramId:telegramId!,telegramAuthSource:current.session.telegramAuthSource,botId:botId!};
  reauthorize.forCurrentDirectCreate=(tx,userId,key)=>authorizeCurrentDirectCreation(tx,binding,userId,key);
  reauthorize.forCurrentDirectBid=(client,userId,input)=>binding.botId===contactBotId()?prepareAtomicDirectBid(client,binding,userId,input):Promise.resolve(null);
  if(directTopUpReady)reauthorize.forCurrentDirectTopUp=(client,userId,input)=>binding.botId===contactBotId()?prepareAtomicDirectTopUp(client,binding,userId,input):Promise.resolve(null);
  reauthorize.forWalletBatch=(tx,userId,key)=>authorizeWalletBatch(tx,binding,userId,key);
  reauthorize.forBidBatchQuote=(tx,userId,key)=>authorizeBidBatchQuote(tx,binding,userId,key);
  reauthorize.forWalletCashCommand=(client,userId,input)=>binding.botId===contactBotId()?runAtomicCashWalletCommand(client,binding,userId,input):Promise.resolve(null);
 }
 return {userId:current.user.id,reauthorize};
}

export async function requirePaymentSession(request:Request){
 const current=await paymentIdentity(request);
 await measureChapa('auth_limit',()=>limitUserMutation(request,current.user.id));
 return paymentSession(request,current);
}

/** Uses the same durable quota and still authorizes again under financial locks. */
export async function requireCountedPaymentSession(request:Request,options:{directKey?:string}={}){
 const result=await measureChapa('auth_session',()=>getCountedMiniSession(request.headers,options));
 if(!result)throw new PrivateApiError(401,'Sign in through Telegram.');
 if(!result.rateAllowed)throw mutationRateError();
 return {...paymentSession(request,result.identity,result.directTopUpReady),directOriginal:result.directOriginal};
}

/** Overlap only bounded read-only preparation with the unchanged durable quota.
 * A rejected read is captured immediately; it cannot bypass the limiter, mask
 * its error, start a money transaction, or expose data before authorization. */
export async function requirePaymentSessionWithRead<T>(request:Request,read:(userId:string)=>Promise<T>){
 const current=await paymentIdentity(request),session=paymentSession(request,current);
 const prepared=Promise.resolve().then(()=>read(session.userId)).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
 await measureChapa('auth_limit',()=>limitUserMutation(request,session.userId));
 const result=await prepared;if(!result.ok)throw result.error;
 return {...session,prepared:result.value};
}
