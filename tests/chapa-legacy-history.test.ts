import {Prisma,type ChapaCheckout,type PrismaClient} from '@prisma/client';
import {describe,expect,it,vi} from 'vitest';
import {ownChapaCheckout,unsupportedLegacyChapaCheckout,verifyChapaCheckout} from '../src/modules/payments/chapa';
import type {ChapaTransport} from '../src/modules/payments/chapa-provider';

function historical(){
 return {id:'769b5a82-67a6-4565-a09d-cc56b30b8258',userId:'historical-owner',flowVersion:3,initialization:{apiVersion:'v1'},purpose:'TOP_UP',mode:'live',amountCents:4000n,currency:'ETB',status:'PENDING',reason:'AWAITING_PAYMENT',providerStatus:null,verificationState:'UNVERIFIED',chargeType:'HOSTED',merchantReference:'LWhistoricalreference',paymentMethod:'telebirr',chapaReference:null,checkoutUrl:'https://checkout.chapa.co/historical',creditJournalId:null,receipt:null,payerPhoneCipher:null,discountPoints:new Prisma.Decimal(0),createdAt:new Date('2026-11-01T10:00:00Z'),updatedAt:new Date('2026-11-01T10:00:00Z'),expiresAt:new Date('2026-11-02T10:00:00Z')} as unknown as ChapaCheckout;
}

describe('retired checkout history stays read-only',()=>{
 it('marks the saved protocol without changing its actual financial status or amount',()=>{
  const saved=historical(),projection=ownChapaCheckout(saved);
  expect(projection).toMatchObject({apiVersion:'legacy',unsupportedLegacy:true,flowVersion:3,status:'PENDING',amount:'40.00',amountCents:'4000',merchantReference:saved.merchantReference,verificationState:'UNVERIFIED'});
  expect(saved.status).toBe('PENDING');expect(saved.creditJournalId).toBeNull();
 });
 it('recognizes retired rows by either immutable version or stored protocol and keeps v2 active',()=>{
  expect(unsupportedLegacyChapaCheckout({flowVersion:3,initialization:{}})).toBe(true);
  expect(unsupportedLegacyChapaCheckout({flowVersion:2,initialization:{apiVersion:'v1'}})).toBe(true);
  for(const flowVersion of [1,2,4])expect(unsupportedLegacyChapaCheckout({flowVersion,initialization:{apiVersion:'v2'}})).toBe(false);
 });
 it('returns only owned history without a provider lookup, lease, initialization or credit',async()=>{
  const saved=historical(),read=vi.fn(async()=>saved),write=vi.fn(),transaction=vi.fn(),transport={lookup:vi.fn(),create:vi.fn(),methods:vi.fn()} as unknown as ChapaTransport;
  const db={chapaCheckout:{findFirst:read,updateMany:write},$transaction:transaction} as unknown as PrismaClient;
  expect(await verifyChapaCheckout(db,saved.id,saved.userId,undefined,transport,true)).toMatchObject({apiVersion:'legacy',unsupportedLegacy:true,status:'PENDING'});
  expect(read).toHaveBeenCalledWith({where:{id:saved.id,userId:saved.userId}});expect(write).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled();expect(transport.lookup).not.toHaveBeenCalled();expect(transport.create).not.toHaveBeenCalled();expect(transport.methods).not.toHaveBeenCalled();
 });
 it('does not expose another account\'s retired payment',async()=>{
  const db={chapaCheckout:{findFirst:vi.fn(async()=>null)}} as unknown as PrismaClient;
  await expect(verifyChapaCheckout(db,historical().id,'different-owner')).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
 });
});

