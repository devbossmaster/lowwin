import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {creditDevelopmentPoints} from '../src/modules/wallet/ledger';
import {earnedReferralCoupon,guardedReferralFixture,realReferralAuction,verifiedReferralUser} from './referral-fixtures';

// Browser tests must provision their own real records on a migrated disposable
// database. They must never depend on an ignored .local fixture or mint a coupon.
export async function referralBrowserPolicy(db:PrismaClient){
 guardedReferralFixture();
 if(process.env.REFERRAL_REWARDS_SCHEMA_READY!=='true')throw Error('Migrated referral browser schema must be explicitly enabled');
 const policy=await db.referralPolicy.upsert({where:{id:'default'},update:{},create:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-browser-fixture'}});
 if(!policy.enabled)throw Error('An active disposable referral policy is required for browser fixtures');
 return policy;
}

export async function referralBrowserFixture(db:PrismaClient){
 await referralBrowserPolicy(db);
 const previous={NODE_ENV:process.env.NODE_ENV,DEV_POINTS_ENABLED:process.env.DEV_POINTS_ENABLED};
 Object.assign(process.env,{NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
 try{
  const user=await verifiedReferralUser(db,'Profile referral QA');
  await creditDevelopmentPoints(db,user.id,'100',`referral-browser-${randomUUID()}`);
  const earned=await earnedReferralCoupon(db,user.id);
  const auction=await realReferralAuction(db,20);
  return {user,auction,coupon:earned.coupon};
 }finally{
  for(const key of ['NODE_ENV','DEV_POINTS_ENABLED'] as const){const value=previous[key];if(value===undefined)Reflect.deleteProperty(process.env,key);else Object.assign(process.env,{[key]:value})}
 }
}
