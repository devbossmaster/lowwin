import {V2_FALLBACK_TERMS,V2_CANCELLATION_TERMS} from '../src/modules/auctions/rules';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { creditDevelopmentPoints } from '../src/modules/wallet/ledger';

export async function bidUser(client:PrismaClient,points='1000') {
  const id=randomUUID();
  await client.user.create({data:{id,name:'Bid fixture'}});
  if(BigInt(points)>0n)await creditDevelopmentPoints(client,id,points,`bid-fixture-${randomUUID()}`);
  return id;
}
export async function bidAuction(client:PrismaClient,options:{fee?:number;min?:number;max?:number;step?:number;endDelayMs?:number;startOffsetMs?:number;isDemo?:boolean;ruleVersion?:string}={}) {
  const suffix=randomUUID().slice(0,8),code=`TEST-BID-${suffix}`,slug=`test-bid-${suffix}`;
  const category=await client.category.create({data:{slug:`test-category-${suffix}`,name:`Test category ${suffix}`,description:'Disposable bid test category'}});
  const product=await client.product.create({data:{slug:`test-product-${suffix}`,title:'Disposable test item',description:'DEMO fixture, no real prize.',condition:'DEMO',categoryId:category.id,isDemo:true}});
  const now=Date.now();
  const auction=await client.auction.create({data:{code,slug,productId:product.id,categoryId:category.id,status:options.ruleVersion==='lowest-unique-v2'?'DRAFT':'LIVE',startsAt:new Date(now+(options.startOffsetMs??-60000)),endsAt:new Date(now+(options.endDelayMs??600000)),publishedAt:options.ruleVersion==='lowest-unique-v2'?null:new Date(now-60000),isDemo:options.isDemo??true,isSettlementFixture:options.isDemo??true,fulfillmentSummary:'DEMO only',fulfillmentRegion:'DEMO'}});
  await client.auctionTerms.create({data:{auctionId:auction.id,ruleVersion:options.ruleVersion??'lowest-unique-v1',minParticipants:options.ruleVersion==='lowest-unique-v2'?2:0,minPoints:BigInt(options.min??1),maxPoints:BigInt(options.max??200),stepPoints:BigInt(options.step??1),entryFeePoints:BigInt(options.fee??0),maxDistinctBids:100,noWinnerTerms:options.ruleVersion==='lowest-unique-v2'?V2_FALLBACK_TERMS:'No unique amount means no winner.',cancellationTerms:options.ruleVersion==='lowest-unique-v2'?V2_CANCELLATION_TERMS:'Cancellation returns holds and fees.',fulfillmentSnapshot:'DEMO only'}});
  if(options.ruleVersion==='lowest-unique-v2')return client.auction.update({where:{id:auction.id},data:{publishedAt:new Date(now-60000),status:'LIVE'}});
  return auction;
}
