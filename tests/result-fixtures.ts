import {randomInt,randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction} from '../src/modules/auctions/settlement';
import {contactBotId,encryptPhone,phoneHash} from '../src/modules/auth/own-contact';

export async function richFinalResult(db:PrismaClient){
 const url=new URL(process.env.DATABASE_URL??'');if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback fixture required');
 Object.assign(process.env,{NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
 const auction=await bidAuction(db,{fee:1,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:20000});
 const title='QA fixture · completed auction '+randomUUID().slice(0,6);
 await db.product.update({where:{id:auction.productId!},data:{title,titleAm:'የሙከራ ዕቃ · የተጠናቀቀ ጨረታ',images:{create:{path:'/catalog/accessory.svg',alt:'QA fixture product illustration',sourceType:'ORIGINAL'}}}});
 const users=await Promise.all(Array.from({length:21},()=>bidUser(db,'1000')));
 const phone='+2519'+String(randomInt(10000000,99999999)),botId=contactBotId(),telegramId=String(randomInt(7000000000,7900000000));
 await db.user.update({where:{id:users[0]},data:{telegramId}});
 await db.telegramOwnContact.create({data:{userId:users[0],telegramId,botId,phoneCipher:encryptPhone(phone,botId),phoneHash:phoneHash(phone),lastFour:phone.slice(-4),verifiedAt:new Date(),sourceUpdateId:BigInt(randomInt(500000000000,600000000000))}});
 const phones=[phone];
 for(const userId of users.slice(1)){
  const identity=String(randomInt(7000000000,7900000000)),number='+2519'+String(randomInt(10000000,99999999));phones.push(number);
  await db.user.update({where:{id:userId},data:{telegramId:identity}});
  await db.telegramOwnContact.create({data:{userId,telegramId:identity,botId,phoneCipher:encryptPhone(number,botId),phoneHash:phoneHash(number),lastFour:number.slice(-4),verifiedAt:new Date(),sourceUpdateId:BigInt(randomInt(500000000000,600000000000))}});
 }
 for(let index=1;index<=21;index++)for(const userId of users.slice(0,2))await submitBid(db,{userId,auctionSlug:auction.slug!,amount:String(index*2),key:randomUUID(),feeVersion:1});
 for(const userId of users)await submitBid(db,{userId,auctionSlug:auction.slug!,amount:'50',key:randomUUID(),feeVersion:1});
 await submitBid(db,{userId:users[0],auctionSlug:auction.slug!,amount:'100',key:randomUUID(),feeVersion:1});
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+40)));
 const settlement=await closeAuction(db,auction.id);
 if(settlement.outcome!=='WINNER'||settlement.winningPoints?.toString()!=='100')throw Error('Fixture settlement mismatch');
 return {auction,settlement,users,phone,phones,title,code:String(auction.publicCode)};
}
