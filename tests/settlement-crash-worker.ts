import { PrismaClient } from '@prisma/client';
import { closeAuction,closeAuctionInTransaction } from '../src/modules/auctions/settlement';
const url=new URL(process.env.DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Disposable loopback test only');
const client=new PrismaClient();
const [mode,auctionId]=process.argv.slice(2);
if(mode==='before')await client.$transaction(async tx=>{await closeAuctionInTransaction(tx,auctionId);process.exit(79)},{timeout:30000});
else {await closeAuction(client,auctionId);process.exit(79)}
