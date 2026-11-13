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
if(!['unit','browser','payments','smoke','redesign','admin','chapa','nov7'].includes(mode))throw Error('Choose unit, browser, payments, smoke, redesign, admin, chapa, or nov7.');
// A focused reproduction uses the exact release harness and fresh databases.
// Normal CI supplies no files and still runs every suite with the no-skip gate.
const files=process.argv.slice(3);
if(files.length&&(mode!=='unit'||files.some(file=>!/^tests\/[a-z0-9-]+\.test\.ts$/.test(file)||!existsSync(file))))throw Error('Unit subsets must name existing tests/name.test.ts files.');
const variables=['TEST_DATABASE_URL','BID_TEST_DATABASE_URL','SETTLEMENT_TEST_DATABASE_URL','PERSONAL_TEST_DATABASE_URL','ADMIN_TEST_DATABASE_URL','MASTER_ADMIN_TEST_DATABASE_URL','OPS_TEST_DATABASE_URL','PAYMENT_TEST_DATABASE_URL','ARIFPAY_TEST_DATABASE_URL','CHAPA_TEST_DATABASE_URL','CHAPA_DIRECT_TEST_DATABASE_URL','ADMIN_CREDIT_TEST_DATABASE_URL','ACTIVITY_TEST_DATABASE_URL','CATALOG_WORKFLOW_TEST_DATABASE_URL','CATALOG_TEST_DATABASE_URL','REFERRAL_TEST_DATABASE_URL','RESULT_TEST_DATABASE_URL','DEPOSIT_BONUS_GUARD_TEST_DATABASE_URL','TELEGRAM_BROWSER_TEST_DATABASE_URL'];
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
if(mode==='chapa'||mode==='nov7')Object.assign(env,{CHAPA_TEST_DATABASE_URL:env.TEST_DATABASE_URL,CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'false',CHAPA_SCHEMA_READY:'false',CHAPA_MODE:'test',CHAPA_PRIVATE_KEY:'',CHAPA_WEBHOOK_SECRET:'',CHAPA_RECOVERY_BINDINGS:'',CHAPA_LIVE_ENABLED:'false',CHAPA_MERCHANT_REVIEWED:'false',CHAPA_DIRECT_EBIRR_ENABLED:'false',WALLET_BIDS_ENABLED:'false',WALLET_BIDS_LIVE_ENABLED:'false',PAYMENTS_LIVE_ENABLED:'false',ARIFPAY_ENABLED:'false'});
if(mode==='nov7'){
 const port=Number(env.NOV7_PORT??3157);if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid isolated November browser port.');
 const origin=`https://localhost:${port}`;
 // Build and runtime use the same isolated fixture identity configuration.
 // Explicit values override any developer .env loaded automatically by Next.
 Object.assign(env,{LOWIN_UI_TEST_MODE:'chapa',BETTER_AUTH_URL:origin,MINI_APP_URL:origin,BETTER_AUTH_SECRET:'local-nov7-auth-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:'123456789:local_nov7_test_token_20261107',TELEGRAM_BOT_USERNAME:'lowin_nov7_bot',TELEGRAM_WEBHOOK_SECRET:'local-nov7-webhook-secret-at-least-thirty-two',PHONE_CONTACT_KEY_ID:'local-nov7',PHONE_CONTACT_KEYS:JSON.stringify({'local-nov7':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false',REFERRAL_REWARDS_SCHEMA_READY:'true',NOV7_STAGE:'after',NOV7_RUN_NAME:'ci',NOV7_PORT:String(port)});
}
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
  if(mode==='admin'){
    env.LOWIN_UI_TEST_MODE='admin-neutral';env.PAYMENTS_LIVE_ENABLED='false';env.ARIFPAY_ENABLED='false';
    const runtimeNodeEnv=env.NODE_ENV;env.NODE_ENV='production';
    run(['node_modules/next/dist/bin/next','build','--webpack']);
    env.NODE_ENV=runtimeNodeEnv??'development';
  }else if(mode!=='chapa'&&mode!=='nov7')run(['node_modules/tsx/dist/cli.mjs','scripts/seed-catalog.ts']);
  if(mode==='nov7'){
    const runtimeNodeEnv=env.NODE_ENV;env.NODE_ENV='production';
    run(['node_modules/next/dist/bin/next','build','--webpack']);
    env.NODE_ENV=runtimeNodeEnv??'development';
  }
  if(mode==='redesign'&&env.REDESIGN_PRODUCTION==='1'){
    env.LOWIN_UI_TEST_MODE='local';
    const runtimeNodeEnv=env.NODE_ENV;env.NODE_ENV='production';
    run(['node_modules/next/dist/bin/next','build','--webpack']);
    env.NODE_ENV=runtimeNodeEnv??'development';
  }
  run(['node_modules/@playwright/test/cli.js','test','--config',mode==='nov7'?'playwright.nov7.config.ts':mode==='chapa'?'playwright.chapa.config.ts':mode==='admin'?'playwright.admin-workspace.config.ts':mode==='redesign'?'playwright.redesign.config.ts':mode==='payments'?'playwright.payments.config.ts':mode==='smoke'?'playwright.release.config.ts':'playwright.config.ts']);
}
