import {describe,expect,it,vi} from 'vitest';
import {CHAPA_V1_HOSTED_ONLY_MIGRATION,CHAPA_V1_MIGRATION,chapaV1ConfigurationReport,checkChapaV1Readiness,type ChapaV1SchemaSnapshot} from '../src/modules/payments/chapa-v1-readiness';
import {chapaWorkerConfiguration} from '../src/modules/payments/chapa-readiness';

const environment=(patch:Record<string,string|undefined>={})=>({APP_ENV:'production',NODE_ENV:'production',DATABASE_URL:'postgresql://private:private@database.example/private',MINI_APP_URL:'https://lowwin.shop',BETTER_AUTH_URL:'https://lowwin.shop',CHAPA_MODE:'live',CHAPA_SCHEMA_READY:'true',CHAPA_MERCHANT_REVIEWED:'true',CHAPA_LIVE_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',CHAPA_V1_ENABLED:'true',CHAPA_V1_SECRET_KEY:'CHASECK-'+'a'.repeat(32),CHAPA_V1_PUBLIC_KEY:'CHAPUBK-'+'b'.repeat(32),CHAPA_V1_WEBHOOK_SECRET:'private-v1-webhook-secret-at-least-thirty-two-characters',CHAPA_V1_METHODS:'telebirr,cbebirr,mpesa',...patch});
const schema=(patch:Partial<ChapaV1SchemaSnapshot>={}):ChapaV1SchemaSnapshot=>({appliedMigrations:[CHAPA_V1_MIGRATION],constraints:['chapa_v1_version','chapa_v1_inline_fields'],reconcileIndex:true,...patch});

describe('redacted v1 deployment readiness',()=>{
 it('stays offline by default and reports only allowlisted fields',async()=>{
  const raw=environment(),report=await checkChapaV1Readiness(raw);
  expect(report).toMatchObject({configured:true,creationEnabled:true,recoveryEnabled:true,ready:true,missingPrerequisites:[],enabledMethods:['telebirr','cbebirr','mpesa'],schema:{status:'not-requested'}});
  const serialized=JSON.stringify(report);for(const value of [raw.CHAPA_V1_SECRET_KEY,raw.CHAPA_V1_PUBLIC_KEY,raw.CHAPA_V1_WEBHOOK_SECRET,raw.DATABASE_URL,raw.MINI_APP_URL,'credentialFingerprint'])expect(serialized).not.toContain(value);
 });
 it('distinguishes valid configuration from a missing method whitelist',()=>{
  const report=chapaV1ConfigurationReport(environment({CHAPA_V1_METHODS:''}));
  expect(report).toMatchObject({configured:true,creationEnabled:true,methodSelectionRequired:true,readyForNewPayments:false,enabledMethods:[]});
 });
 it('does not echo unknown method values or enable them',()=>{
  const raw=environment({CHAPA_V1_METHODS:'telebirr,private-method-token,telebirr'}),report=chapaV1ConfigurationReport(raw);
  expect(report.configuredMethods).toEqual(['telebirr']);expect(report.enabledMethods).toEqual(['telebirr']);expect(report.unrecognizedMethodsPresent).toBe(true);expect(JSON.stringify(report)).not.toContain('private-method-token');
 });
 it('accepts an explicitly enabled hosted branch without inventing wallet methods',()=>{
  expect(chapaV1ConfigurationReport(environment({CHAPA_V1_METHODS:'',CHAPA_V1_CBE_BANK_ENABLED:'true'}))).toMatchObject({readyForNewPayments:true,methodSelectionRequired:false,cbeBankEnabled:true,enabledMethods:[]});
 });
 it('lists missing v1 credentials independently of configured historical v2 recovery',()=>{
  const raw=environment({CHAPA_V1_SECRET_KEY:undefined,CHAPA_V1_PUBLIC_KEY:undefined,CHAPA_V1_WEBHOOK_SECRET:undefined,CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'z'.repeat(32),CHAPA_WEBHOOK_SECRET:'historical-webhook-secret-at-least-thirty-two-characters',CHAPA_RECOVERY_ENABLED:'true'});
  expect(chapaWorkerConfiguration(raw)).toMatchObject({recoveryEnabled:true,v2RecoveryEnabled:true,v1RecoveryEnabled:false,v1:{configured:false,readyForNewPayments:false,missingPrerequisites:expect.arrayContaining(['CHAPA_V1_SECRET_KEY','CHAPA_V1_PUBLIC_KEY','CHAPA_V1_WEBHOOK_SECRET'])}});
 });
 it('reports paused creation gates while allowing recovery',()=>{
  const raw=environment({CHAPA_V1_ENABLED:'false',CHAPA_V1_RECOVERY_ENABLED:'true',CHAPA_LIVE_ENABLED:'false'}),before={...raw};
  expect(chapaV1ConfigurationReport(raw)).toMatchObject({configured:true,creationEnabled:false,recoveryEnabled:true,disabledCreationGates:['CHAPA_V1_ENABLED','CHAPA_LIVE_ENABLED'],readyForNewPayments:false});expect(raw).toEqual(before);
 });
 it.each([
  ['CHAPA_V1_SECRET_KEY','CHAPA_LIVE_'+ 'a'.repeat(32)],['CHAPA_V1_PUBLIC_KEY','CHAPUBK_TEST-'+ 'b'.repeat(32)],['CHAPA_V1_WEBHOOK_SECRET','short'],['CHAPA_SCHEMA_READY','false'],['CHAPA_MODE','unknown'],['APP_ENV','staging'],['NODE_ENV','development'],['CHAPA_MERCHANT_REVIEWED','false'],['DEV_IDENTITY_ENABLED','true'],['DEV_POINTS_ENABLED','true'],['STAGING_DEMO_ENABLED','true'],['VERCEL_ENV','preview'],
 ])('names the invalid gate %s without echoing its value',(key,value)=>{
  const report=chapaV1ConfigurationReport(environment({[key]:value}));expect(report.readyForNewPayments).toBe(false);expect(report.missingPrerequisites).toContain(key);
 });
 it('validates reviewed test environment gates using the current availability rules',()=>{
  const raw=environment({APP_ENV:'staging',NODE_ENV:'test',CHAPA_MODE:'test',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(32),CHAPA_V1_PUBLIC_KEY:'CHAPUBK_TEST-'+'b'.repeat(32)});
  expect(chapaV1ConfigurationReport(raw)).toMatchObject({configured:false,missingPrerequisites:['CHAPA_TEST_ENVIRONMENT_REVIEWED']});
  expect(chapaV1ConfigurationReport({...raw,CHAPA_TEST_ENVIRONMENT_REVIEWED:'true'})).toMatchObject({configured:true,readyForNewPayments:true});
 });
 it('reads only supplied schema metadata when explicitly requested',async()=>{
  const read=vi.fn(async()=>schema()),report=await checkChapaV1Readiness(environment(),read);
  expect(read).toHaveBeenCalledTimes(1);expect(report).toMatchObject({ready:true,schema:{status:'ok',applied:true,hostedOnlyMigrationApplied:false,missingConstraints:[],reconcileIndex:true}});
 });
 it('reports a pending shared-checkout migration',async()=>{
  expect(await checkChapaV1Readiness(environment(),async()=>schema({appliedMigrations:[],constraints:[],reconcileIndex:false}))).toMatchObject({ready:false,schema:{status:'pending',applied:false,expectedMigration:CHAPA_V1_MIGRATION}});
 });
 it('distinguishes PR15 hosted-only migration and refuses to call it ready',async()=>{
  for(const appliedMigrations of [[CHAPA_V1_HOSTED_ONLY_MIGRATION],[CHAPA_V1_MIGRATION,CHAPA_V1_HOSTED_ONLY_MIGRATION]])expect(await checkChapaV1Readiness(environment(),async()=>schema({appliedMigrations}))).toMatchObject({ready:false,schema:{status:'conflicting',hostedOnlyMigrationApplied:true}});
 });
 it('detects incomplete schema guards or reconciliation index',async()=>{
  for(const patch of [{constraints:['chapa_v1_version']},{reconcileIndex:false}])expect(await checkChapaV1Readiness(environment(),async()=>schema(patch))).toMatchObject({ready:false,schema:{status:'incomplete'}});
 });
 it('sanitizes schema connection failures',async()=>{
  const raw=environment(),report=await checkChapaV1Readiness(raw,async()=>{throw Error(raw.DATABASE_URL)});
  expect(report).toMatchObject({ready:false,schema:{status:'unavailable'}});expect(JSON.stringify(report)).not.toContain(raw.DATABASE_URL);
 });
});
