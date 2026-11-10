import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {publishSettledResult,recordPublicationFailure} from '../src/modules/auctions/result-publication';

/** Read-only by default. Explicit historical backfill is always silent and
 * cannot choose a winner, rewrite settlement or create announcement intents. */
const db=new PrismaClient(),apply=process.argv.includes('--apply-silent'),limit=Math.max(1,Math.min(100,Number(process.argv.find(v=>v.startsWith('--limit='))?.split('=')[1]??25)||25));
try{
 const policy=await db.resultPublicationPolicy.findUnique({where:{id:'auto'}});
 if(!policy)throw Error('PUBLICATION_POLICY_NOT_READY');
 const eligible={ruleVersion:{in:['lowest-unique-v2','lowest-unique-v3','lowest-unique-v4']},outcome:'WINNER',participantCount:{gte:2},auction:{is:{isDemo:false,testRunId:null}}};
 const groups=await db.auctionSettlement.groupBy({by:['decision'],where:eligible,_count:{_all:true}});
 const unique=groups.find(g=>g.decision==='LOWEST_UNIQUE')?._count._all??0,fallback=groups.find(g=>g.decision==='FIRST_ACCEPTED_LOWEST')?._count._all??0;
 console.log(JSON.stringify({event:'winner_history_observation',eligibleWinnerSettlements:unique+fallback,lowestUnique:unique,noUniqueFallback:fallback,noUniqueRate:unique+fallback?fallback/(unique+fallback):null,excludedUnknownDecision:groups.filter(g=>!['LOWEST_UNIQUE','FIRST_ACCEPTED_LOWEST'].includes(g.decision??'')).reduce((n,g)=>n+g._count._all,0),limitation:'Observed eligible database settlements only; excludes cancellations, fixtures and v1. Not a future probability.'}));
 const rows=await db.auctionSettlement.findMany({where:{publication:{is:null},completedAt:{lt:policy.automaticFrom},auction:{is:{isDemo:false,testRunId:null,status:{in:['CLOSED','CANCELLED']}}}},select:{id:true,auctionId:true},orderBy:[{completedAt:'asc'},{id:'asc'}],take:limit});
 console.log(JSON.stringify({event:'historical_publication_backfill',mode:apply?'apply-silent':'review-only',candidateCount:rows.length,limit,automaticFrom:policy.automaticFrom.toISOString(),notificationsEnabled:false}));
 if(apply)for(const row of rows){try{const result=await publishSettledResult(db,row.auctionId,{forceSilent:true});console.log(JSON.stringify({event:'historical_publication_result',...result}))}catch(error){console.log(JSON.stringify(await recordPublicationFailure(db,row.auctionId,error)))}}
}catch{console.error(JSON.stringify({error:'RESULT_PUBLICATION_AUDIT_UNAVAILABLE'}));process.exitCode=1}finally{await db.$disconnect()}
