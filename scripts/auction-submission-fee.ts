import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {adoptSubmissionFee} from '../src/modules/auctions/adopt-submission-fee';
import {clearPublicDataCache} from '../src/modules/cache/public-data';
const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]};
let db:PrismaClient|undefined;
try{
 const code=value('--auction'),fee=value('--fee'),url=process.env.DIRECT_URL??process.env.DATABASE_URL;
 if(!code||!fee||!url)throw Error('Usage: npm run auction:fee-only -- --auction LW-CODE --fee AMOUNT [--apply]');
 const target=new URL(url);console.log(JSON.stringify({host:target.hostname,database:target.pathname.slice(1),mode:args.includes('--apply')?'apply':'preview'}));
 db=new PrismaClient({datasources:{db:{url}}});
 const result=await adoptSubmissionFee(db,code,fee,args.includes('--apply'));console.log(JSON.stringify(result,null,2));
 if(result.applied)await clearPublicDataCache();else console.log('Preview only. Add --apply to convert this auction and release its bid holds.');
}catch(error){console.error(error instanceof Error&&!(error instanceof Error&&error.name.startsWith('Prisma'))?error.message:'Database operation failed. No partial conversion was committed.');process.exitCode=1}
finally{await db?.$disconnect()}
