import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';

// Creates fresh databases; never drops/resets an existing database or loads .env.
const base = new URL(process.env.TEST_DATABASE_URL ?? '');
if (!['127.0.0.1','localhost'].includes(base.hostname) || !base.pathname.endsWith('_test'))
  throw Error('Explicit disposable loopback TEST_DATABASE_URL ending in _test required.');
const suffix = randomBytes(5).toString('hex');
const mode=process.argv[2]??'unit';
if(!['unit','browser','payments','smoke','redesign'].includes(mode))throw Error('Choose unit, browser, payments, smoke, or redesign.');
// A focused reproduction uses the exact release harness and fresh databases.
// Normal CI supplies no files and still runs every suite with the no-skip gate.
const files=process.argv.slice(3);
if(files.length&&(mode!=='unit'||files.some(file=>!/^tests\/[a-z0-9-]+\.test\.ts$/.test(file)||!existsSync(file))))throw Error('Unit subsets must name existing tests/name.test.ts files.');
const variables=['TEST_DATABASE_URL','BID_TEST_DATABASE_URL','SETTLEMENT_TEST_DATABASE_URL','PERSONAL_TEST_DATABASE_URL','ADMIN_TEST_DATABASE_URL','OPS_TEST_DATABASE_URL','PAYMENT_TEST_DATABASE_URL','ARIFPAY_TEST_DATABASE_URL','ADMIN_CREDIT_TEST_DATABASE_URL','ACTIVITY_TEST_DATABASE_URL','CATALOG_WORKFLOW_TEST_DATABASE_URL','CATALOG_TEST_DATABASE_URL','REFERRAL_TEST_DATABASE_URL','RESULT_TEST_DATABASE_URL'];
const env={...process.env};
const admin=new URL(base);admin.pathname='/postgres';
const client=new Client({connectionString:admin.href});
await client.connect();
const names=[];
try {
  for(const [index,key] of (mode==='unit'?variables:['TEST_DATABASE_URL']).entries()) {
    const name=`lowwin_release_${mode}_${suffix}_${index}_test`;
    await client.query(`CREATE DATABASE "${name}"`);
    const url=new URL(base);url.pathname=`/${name}`;env[key]=url.href;names.push(name);
  }
} finally {await client.end();}
env.DATABASE_URL=env.DIRECT_URL=env.TEST_DATABASE_URL;
env.APP_ENV='local';
mkdirSync('test-results/release',{recursive:true});
writeFileSync(`test-results/release/${mode}-databases.json`,JSON.stringify(names,null,2));
const run=(args)=>{const r=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1)};
if(mode==='unit') {
  run(['node_modules/vitest/vitest.mjs','run',...files,'--reporter=default','--reporter=json','--outputFile=test-results/release/unit.json']);
  const report=JSON.parse(readFileSync('test-results/release/unit.json','utf8'));
  if(report.numPendingTests||report.numTodoTests)throw Error('Release requires every opt-in database test to execute.');
} else {
  run(['node_modules/prisma/build/index.js','migrate','deploy']);
  run(['node_modules/tsx/dist/cli.mjs','scripts/seed-catalog.ts']);
  run(['node_modules/@playwright/test/cli.js','test','--config',mode==='redesign'?'playwright.redesign.config.ts':mode==='payments'?'playwright.payments.config.ts':mode==='smoke'?'playwright.release.config.ts':'playwright.config.ts']);
}
