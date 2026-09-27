import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {readFileSync,writeFileSync} from 'node:fs';
import {stagingDemoEnabled} from '../src/modules/auctions/staging-demo';
import {contactBotId} from '../src/modules/auth/own-contact';
import {creditDemoPoints,reconcile} from '../src/modules/wallet/ledger';
const batch=process.argv[process.argv.indexOf('--batch')+1];
if(!process.argv.includes('--batch')||!/^[a-z0-9-]{1,32}$/.test(batch)||!stagingDemoEnabled())throw Error('Explicit pinned staging invocation required');
const db=new PrismaClient({datasourceUrl:process.env.DIRECT_URL,transactionOptions:{timeout:120000}});
try{
 // An operator invocation, never /start, contact sharing or an HTTP endpoint.
 const contacts=await db.telegramOwnContact.findMany({where:{botId:contactBotId(),revokedAt:null,userId:{not:null}},orderBy:{verifiedAt:'asc'},take:21});
 const ids:string[]=[];for(const contact of contacts){const user=await db.user.findUnique({where:{id:contact.userId!},select:{telegramId:true,staffMember:true}}),chat=await db.botChat.findUnique({where:{telegramId:contact.telegramId}});if(user?.telegramId===contact.telegramId&&!user.staffMember&&chat&&!chat.blocked)ids.push(contact.userId!)}
 const enrolled=[...new Set([...(process.env.STAGING_DEMO_USER_IDS??'').split(',').filter(Boolean),...ids])];if(enrolled.length>20)throw Error('Bounded allowlist exceeded; review the first 20 testers explicitly');
 if(ids.length){process.env.STAGING_DEMO_USER_IDS=enrolled.join(',');const file=readFileSync('.env','utf8'),line=`STAGING_DEMO_USER_IDS='${enrolled.join(',')}'`;writeFileSync('.env',/^STAGING_DEMO_USER_IDS=.*$/m.test(file)?file.replace(/^STAGING_DEMO_USER_IDS=.*$/m,line):file+'\n'+line+'\n');for(const id of ids)await creditDemoPoints(db,id,'1000',`demo-showcase:${batch}:tester`)}
 if((await reconcile(db)).length)throw Error('Reconciliation failed');console.log(JSON.stringify({grantedOrReplayed:ids.length,boundedAllowlist:enrolled.length,pointsPerTester:1000,restartStagingApp:ids.length>0,reconciliationDrift:0}));
}finally{await db.$disconnect()}
