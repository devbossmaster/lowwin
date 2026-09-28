import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {runtimeDatabaseUrl} from '../src/lib/database-config';
// Read-only, explicit target. Never load the owner's .env implicitly.
const url=new URL(process.env.DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(url.hostname)&&!process.argv.includes('--allow-remote-readonly'))throw Error('Remote measurements require --allow-remote-readonly');
const datasourceUrl=runtimeDatabaseUrl(url.href)!;
Object.assign(process.env,{NODE_ENV:'test'});
const baseline=process.argv.includes('--baseline-checkout')?process.argv[process.argv.indexOf('--baseline-checkout')+1]:null;
const root=baseline?resolve(baseline):process.cwd();
const {PrismaClient}=createRequire(resolve(root,'package.json'))('@prisma/client') as typeof import('@prisma/client');
const client=new PrismaClient({datasourceUrl,log:[{emit:'event',level:'query'}]});
let queries=0;client.$on('query',()=>{queries++});
Object.assign(globalThis,{lowinDb:client,lowinDbConfigKey:createHash('sha256').update(datasourceUrl).digest('hex')});
const catalog=await import(pathToFileURL(resolve(root,'src/modules/auctions/catalog.ts')).href) as typeof import('../src/modules/auctions/catalog');
const {listPublicResults}=await import(pathToFileURL(resolve(root,'src/modules/auctions/results.ts')).href) as typeof import('../src/modules/auctions/results');
const count=Number(process.argv.find(value=>value.startsWith('--samples='))?.split('=')[1]??10);
if(!Number.isInteger(count)||count<3||count>30)throw Error('Use 3 to 30 samples');
const report:Record<string,unknown>={target:['localhost','127.0.0.1'].includes(url.hostname)?'loopback PostgreSQL':'remote read-only',samples:count,at:new Date().toISOString()};
try {
 for(const name of ['home','results'] as const) {
  const samples:number[]=[],queryCounts:number[]=[];let bytes=0;
  for(let i=0;i<count+1;i++) {
   queries=0;const start=performance.now();
   let result:unknown;
   if(name==='home'){const now=await catalog.serverNow();result=await Promise.all([catalog.listCategories(now),catalog.listAuctions({q:'',status:'live',sort:'ending',page:1},now,20),listPublicResults(client)])}
   else result=await listPublicResults(client);
   if(i){samples.push(performance.now()-start);queryCounts.push(queries)}
   bytes=Buffer.byteLength(JSON.stringify(result));
  }
  samples.sort((a,b)=>a-b);report[name]={p50Ms:Math.round(samples[Math.ceil(count*.5)-1]*100)/100,p95Ms:Math.round(samples[Math.ceil(count*.95)-1]*100)/100,queries:queryCounts,payloadBytes:bytes};
 }
 console.log(JSON.stringify(report,null,2));
 mkdirSync('test-results/release',{recursive:true});
 const label=process.argv.includes('--after')?'after':'before',location=report.target==='remote read-only'?'remote-':'';writeFileSync(`test-results/release/catalog-${location}${label}.json`,JSON.stringify(report,null,2));
}finally{await client.$disconnect()}
