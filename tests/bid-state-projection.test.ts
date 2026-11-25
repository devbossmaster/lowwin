import {Prisma} from '@prisma/client';
import {describe,expect,it,vi} from 'vitest';
import {getOwnBidState} from '../src/modules/auctions/bids';

const now=new Date('2026-11-12T10:00:00Z');
function fixture(){
 const auction={id:'owned-auction',code:'LW-OWNED',slug:'owned-auction',publishedAt:new Date(now.getTime()-1000),startsAt:new Date(now.getTime()-1000),endsAt:new Date(now.getTime()+60000),status:'LIVE',isDemo:false,terms:{ruleVersion:'lowest-unique-v4',minParticipants:2,minPoints:new Prisma.Decimal(1),maxPoints:null,stepPoints:new Prisma.Decimal('0.01'),maxDistinctBids:100},feeRevisions:[{version:1,feePoints:new Prisma.Decimal(35)}]};
 const tx={auction:{findUnique:vi.fn(async()=>auction)},$queryRaw:vi.fn(async()=>[{now}]),wallet:{findUnique:vi.fn(async()=>({accounts:[],holds:[]}))},bid:{findMany:vi.fn(async()=>[])},staffMember:{findUnique:vi.fn(async()=>null)},userRestriction:{findUnique:vi.fn(async()=>null)}};
 const client={$transaction:vi.fn(async(fn:(value:typeof tx)=>unknown)=>fn(tx))};
 return {client,tx};
}
describe('checkout bid-state projection',()=>{
 it('returns bid terms without legacy discounts or the independent wallet read',async()=>{
  const {client,tx}=fixture(),state=await getOwnBidState(client as never,'owned-player','owned-auction',{REFERRAL_REWARDS_SCHEMA_READY:'true'},false);
  expect(tx.wallet.findUnique).not.toHaveBeenCalled();expect(state).not.toHaveProperty('couponAvailableCount');expect(state).not.toHaveProperty('referralDiscountsAvailable');
  expect(state.open).toBe(true);expect(state.terms.entryFeePoints).toBe('35');expect(state.remainingSubmissions).toBe(100);
 });
});
