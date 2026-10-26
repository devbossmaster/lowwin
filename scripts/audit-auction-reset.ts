import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'dotenv';
import {Client} from 'pg';
import {createHash} from 'node:crypto';
import {collectResetAudit} from './auction-reset-audit';
const args=process.argv.slice(2),arg=(name:string)=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
async function main(){
 const file=arg('--env'),variable=arg('--variable'),output=arg('--output');if(!file||!variable||!output)throw Error('Provide --env, --variable and an ignored .local --output directory');
 const root=path.resolve('.local'),destination=path.resolve(output);if(!destination.startsWith(root+path.sep))throw Error('Customer inventory must stay under the ignored .local directory');
 const env=parse(fs.readFileSync(file)),url=new URL(env[variable]??''),local=['127.0.0.1','localhost','[::1]'].includes(url.hostname),fixture=args.includes('--fixture');
 if(local!==fixture||fixture&&!url.pathname.endsWith('_test'))throw Error('Only an explicitly marked disposable loopback _test audit may use a non-TLS connection');
 const project=/^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1]??/^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1];
 const pooler=arg('--pooler');if(pooler){if(!project||!/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(pooler))throw Error('A known Supabase project and explicit pooler hostname are required');url.hostname=pooler;url.port='5432';url.username=`postgres.${project}`}
 const ca=arg('--root-cert');if(!fixture&&!ca)throw Error('Verified production TLS requires --root-cert');
 for(const key of ['schema','connection_limit','pool_timeout','pgbouncer','connect_timeout','sslmode','sslrootcert'])url.searchParams.delete(key);
 const db=new Client({connectionString:url.href,ssl:fixture?false:{rejectUnauthorized:true,ca:fs.readFileSync(ca!,'utf8')},connectionTimeoutMillis:15000,application_name:'lowwin-readonly-reset-audit'});
 let connectionFailure:Error|null=null;db.on('error',error=>{connectionFailure=error});
 try{await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query("SET LOCAL statement_timeout='15s'");await db.query("SET LOCAL lock_timeout='1s'");await db.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
  const identity=(await db.query("SELECT current_setting('transaction_read_only') AS read_only,current_database() AS database,current_user AS role,transaction_timestamp() AS snapshot_at,current_setting('server_version') AS version")).rows[0];
  if(identity.read_only!=='on')throw Error('Read-only transaction assertion failed');
  const {connection}=db as unknown as {connection:{stream:{encrypted?:boolean;authorized?:boolean}}};if(!fixture&&(!connection.stream.encrypted||!connection.stream.authorized))throw Error('Verified TLS assertion failed');
  Object.assign(identity,{projectRef:project??'isolated-fixture',verifiedTls:!fixture,targetFingerprint:createHash('sha256').update([url.hostname,url.port,url.pathname,url.username].join('|')).digest('hex')});
  const {schema,inventory,recovery}=await collectResetAudit(db,identity);if(connectionFailure)throw connectionFailure;fs.mkdirSync(destination,{recursive:true});for(const [name,value]of Object.entries({'schema-inventory':schema,'domain-inventory':inventory,'recovery-inventory':recovery}))fs.writeFileSync(path.join(destination,name+'.json'),JSON.stringify(value,null,2)+'\n');
  console.log(JSON.stringify({mode:'READ ONLY',snapshotAt:identity.snapshot_at,verifiedTls:!fixture,schemaHash:schema.schemaHash,users:inventory.users[0].count,auctions:inventory.auctions.length,bids:inventory.bids.length,drift:inventory.drift.length+inventory.unbalanced.length+inventory.heldDrift.length,output:destination}));
 }finally{try{await db.query('ROLLBACK')}catch{}await db.end().catch(()=>{})}
}
main().catch(error=>{console.error('Read-only audit stopped:',error instanceof Error?error.name:'Unknown error','Review the target, network and verified TLS configuration. No production write was attempted.');process.exitCode=1});
