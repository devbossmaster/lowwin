import {randomInt,randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {verifyFixtureContact} from './contact-fixtures';
import {bidAuction} from './bid-fixtures';
import {creditDevelopmentPoints} from '../src/modules/wallet/ledger';
import {contactBotId} from '../src/modules/auth/own-contact';
import {getReferralOverview,recordBotReferralStart} from '../src/modules/referrals/service';
import {submitBid} from '../src/modules/auctions/bids';

export function guardedReferralFixture(){const u=new URL(process.env.DATABASE_URL??'');if(u.hostname!=='127.0.0.1'||!u.pathname.endsWith('_test'))throw Error('Disposable loopback referral database required')}
export async function verifiedReferralUser(db:PrismaClient,name='Referral fixture'){
 guardedReferralFixture();const telegramId=randomInt(8000000000,8900000000);await verifyFixtureContact(db,telegramId);const user=await db.user.update({where:{telegramId:String(telegramId)},data:{name},select:{id:true}});return {id:user.id,telegramId};
}
export async function realReferralAuction(db:PrismaClient,fee=20,endDelayMs=3600000){
 guardedReferralFixture();const auction=await bidAuction(db,{fee,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs});await db.product.update({where:{id:auction.productId!},data:{title:'DEMO referral fee fixture',isDemo:false}});return auction;
}
export async function referredRegistration(db:PrismaClient,referrerUserId:string){
 guardedReferralFixture();const overview=await getReferralOverview(db,referrerUserId);if(!overview.shareUrl)throw Error('Active local referral policy required');const payload=new URL(overview.shareUrl).searchParams.get('start')!,telegramId=randomInt(8000000000,8900000000);
 if(!await recordBotReferralStart(db,String(telegramId),contactBotId(),payload))throw Error('Local referral start rejected');await verifyFixtureContact(db,telegramId);const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});return {id:user.id,telegramId,payload};
}
export async function earnedReferralCoupon(db:PrismaClient,referrerUserId:string){
 const referred=await referredRegistration(db,referrerUserId),auction=await realReferralAuction(db,1);await creditDevelopmentPoints(db,referred.id,'100',`referral-fixture-${randomUUID()}`);const receipt=await submitBid(db,{userId:referred.id,auctionSlug:auction.slug!,feeVersion:1,amount:'7',key:randomUUID()});const coupon=await db.referralCoupon.findUniqueOrThrow({where:{referredUserId:referred.id}});return {referred,auction,receipt,coupon};
}
