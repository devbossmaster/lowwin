import {Prisma,type ChapaCheckout,type PrismaClient} from '@prisma/client';
import {encryptPhone} from '../auth/own-contact';
import {PrivateApiError} from '../auth/private-api';
import {ChapaError} from './chapa-provider';
import {isCurrentDirectCheckout} from './chapa-current-protocol';
import type {PaymentCreationBinding} from './creation-eligibility';

export type DirectBidPreparation={
 checkoutId:string;key:string;batchId:string;quoteHash:string;requestHash:string;phone:string;
 mode:string;credentialFingerprint:string;initialization:Prisma.InputJsonObject;minimumCents:string;maximumCents:string;
};

/** The function returns no row only before financial writes. Carry an actual
 * lost/failed database reply to the caller as uncertain, never as fallback. */
export async function prepareAtomicDirectBid(client:PrismaClient,binding:PaymentCreationBinding,userId:string,input:DirectBidPreparation){
 if(userId!==binding.userId)throw new PrivateApiError(401,'Sign in through Telegram.');
 const {phone,...command}=input,payerPhoneCipher=encryptPhone(phone,binding.botId);
 let rows:ChapaCheckout[];
 try{
  rows=await client.$queryRaw<ChapaCheckout[]>`SELECT * FROM public.lowwin_prepare_direct_bid(${JSON.stringify(binding)}::jsonb,${JSON.stringify({...command,payerPhoneCipher})}::jsonb)`;
 }catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2010'){
   const message=typeof error.meta?.message==='string'?error.meta.message:'';
   if(error.meta?.code==='42883'&&/^(?:ERROR: )?function (?:public\.)?lowwin_prepare_direct_bid\(/.test(message))return null;
   if(error.meta?.code==='P0001'&&/^(?:ERROR: )?LOWWIN_DIRECT_BID_RATE_LIMITED(?:\s|$)/.test(message))throw new ChapaError(429,'RATE_LIMITED','Check Transactions before trying another payment.');
  }
  throw error;
 }
 if(rows.length===0)return null;
 const order=rows[0];
 if(rows.length!==1||!order||order.id!==input.checkoutId||order.userId!==userId||order.key!==input.key||order.requestHash!==input.requestHash||order.batchId!==input.batchId||order.purpose!=='BID'||!isCurrentDirectCheckout(order)||order.status!=='SUBMITTING'||!order.leaseUntil)throw new Error('Direct bid preparation returned an unexpected intent.');
 return order;
}
