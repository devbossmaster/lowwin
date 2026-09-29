import {Client} from 'pg';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

// No reset/drop and no implicit environment file. Never accepts production data.
const source=new URL(process.env.TEST_DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(source.hostname)||!source.pathname.endsWith('_test'))throw Error('Explicit loopback _test database required');
const target=new URL(source),name=`lowwin_restore_${randomBytes(5).toString('hex')}_test`;
target.pathname=`/${name}`;
const admin=new URL(source);admin.pathname='/postgres';
const db=new Client({connectionString:admin.href});await db.connect();
try{await db.query(`CREATE DATABASE "${name}"`)}finally{await db.end()}
mkdirSync('.local/restore',{recursive:true});const backup=resolve('.local/restore',`${name}.dump`);
const pgEnv=url=>({...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)});
const run=(program,args,env)=>{const executable=process.env.PG_BIN?join(process.env.PG_BIN,program+(process.platform==='win32'?'.exe':'')):program;const result=spawnSync(executable,args,{env,encoding:'utf8'});if(result.status!==0)throw Error(`${program} failed: ${(result.stderr??result.error?.message??'unknown').slice(0,1200)}`)};
run('pg_dump',['--format=custom','--no-owner','--no-acl','--file',backup],pgEnv(source));
run('pg_restore',['--exit-on-error','--no-owner','--no-acl','--dbname',name,backup],pgEnv(target));
const tables=['Bid','AuctionTerms','AuctionSettlement','Journal','Posting','AuctionHold','LedgerAccount','Operation','_prisma_migrations'];
async function inventory(url){const c=new Client({connectionString:url.href});await c.connect();try{const result={};for(const table of tables){const rows=await c.query(`SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);result[table]={count:rows.rowCount,hash:createHash('sha256').update(rows.rows.map(r=>r.row).join('\n')).digest('hex')}}const drift=await c.query('SELECT a.id FROM "LedgerAccount" a LEFT JOIN "Posting" p ON p."accountId"=a.id GROUP BY a.id HAVING a.balance<>COALESCE(SUM(p.delta),0)');if(drift.rowCount)throw Error('Restored balance/posting drift');return result}finally{await c.end()}}
const before=await inventory(source),after=await inventory(target);
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Restored immutable records differ');
const report={at:new Date().toISOString(),scope:'Local PostgreSQL custom-format restore; DEMO fixtures only; no encrypted or remote backup claim',source:source.pathname.slice(1),restored:name,backupSha256:createHash('sha256').update(readFileSync(backup)).digest('hex'),matchingTables:before,balancePostingDrift:0};
mkdirSync('test-results/release',{recursive:true});writeFileSync('test-results/release/restore.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
