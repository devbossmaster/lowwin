import {PrismaClient} from '@prisma/client';
import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readOverview,readOverviewSummary,readOverviewAuctions} from '../src/modules/admin/workspace-read';

const database=process.env.TEST_DATABASE_URL??'',url=new URL(database);
if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('An isolated loopback _test database is required.');
process.env.CHAPA_SCHEMA_READY='true';
const db=new PrismaClient({datasourceUrl:database,log:[{level:'query',emit:'event'}]}),queries:{query:string;params:string;duration:number}[]=[];
db.$on('query',event=>queries.push(event));
try{
 await db.$connect();const actor={id:'synthetic-owner',role:'OWNER' as const,now:new Date('2026-11-10T12:00:00Z')};
 const measure=async(name:string,load:()=>Promise<unknown>)=>{queries.length=0;const start=performance.now(),result=await load(),elapsedMs=performance.now()-start;return {name,elapsedMs,sqlQueries:queries.length,databaseMs:queries.reduce((sum,q)=>sum+q.duration,0),responseBytes:Buffer.byteLength(JSON.stringify(result)),statements:[...queries]}};
 // Warm the owned connection pool once; compare repeated reads on the same data.
 await readOverview(db,actor);const before:Awaited<ReturnType<typeof measure>>[]=[],after:Awaited<ReturnType<typeof measure>>[]=[];
 for(let i=0;i<5;i++)before.push(await measure('previous combined Overview',()=>readOverview(db,actor)));
 for(let i=0;i<5;i++)after.push(await measure('progressive minimal Overview',()=>Promise.all([readOverviewSummary(db,actor),readOverviewAuctions(db,actor)])));
 const plans=[];for(const statement of after[0].statements){const parameters=JSON.parse(statement.params).map((value:unknown)=>typeof value==='string'&&/^\d{4}-\d\d-\d\d[ T]/.test(value)?new Date(value):value);const result=await db.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+statement.query,...parameters);plans.push(result)}
 const record={fixture:'owned loopback browser-test dataset; no production access',before,after,plans};mkdirSync('test-results/admin-speed',{recursive:true});writeFileSync('test-results/admin-speed/sql.json',JSON.stringify(record,null,2));
 const summarize=(rows:typeof before)=>({meanMs:rows.reduce((sum,row)=>sum+row.elapsedMs,0)/rows.length,sqlQueries:rows[0].sqlQueries,responseBytes:rows[0].responseBytes});console.log(JSON.stringify({before:summarize(before),after:summarize(after)},null,2));
}finally{await db.$disconnect()}
