import {createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it} from 'vitest';
import {chapaWebhookSignatureConfiguration,diagnoseChapaWebhookSignature} from '../src/modules/payments/chapa-webhook-diagnostic';

const secret='synthetic-webhook-secret-'+'s'.repeat(40),environment={CHAPA_WEBHOOK_SECRET:secret};
const body=Buffer.from('{ "webhook_type":"payment", "customer":{"phone_number":"private-fixture"} }\n');
const sign=(bytes:Uint8Array|string,key=secret)=>createHmac('sha256',key).update(bytes).digest('hex');

describe('offline Chapa Signature diagnosis',()=>{
 it('reports runtime configuration without guessing delivery authentication',()=>{
  expect(chapaWebhookSignatureConfiguration(environment)).toEqual({configuredAuth:'signature',secretPresent:true,configurationValid:true,diagnosis:'SIGNATURE_CONFIGURATION_VALID'});
  expect(chapaWebhookSignatureConfiguration({})).toMatchObject({secretPresent:false,configurationValid:false,diagnosis:'MISSING_WEBHOOK_SECRET'});
  for(const value of ['short','s'.repeat(257),'CHANGE_ME'+'s'.repeat(40)])expect(chapaWebhookSignatureConfiguration({CHAPA_WEBHOOK_SECRET:value})).toMatchObject({configurationValid:false,diagnosis:'INVALID_WEBHOOK_SECRET'});
 });
 it('uses the production validator on exact original bytes including whitespace and BOM',()=>{
  for(const bytes of [body,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),body])])expect(diagnoseChapaWebhookSignature(bytes,sign(bytes),environment)).toMatchObject({authenticationAccepted:true,diagnosis:'MATCHES_RAW_BODY_SIGNATURE',legacyConstantSignatureRejected:false});
 });
 it('rejects changed bytes, reserialized JSON and a different secret',()=>{
  const signature=sign(body);
  for(const bytes of [Buffer.from(JSON.stringify(JSON.parse(body.toString()))),Buffer.concat([body,Buffer.from(' ')])])expect(diagnoseChapaWebhookSignature(bytes,signature,environment)).toMatchObject({authenticationAccepted:false,diagnosis:'SIGNATURE_MISMATCH'});
  expect(diagnoseChapaWebhookSignature(body,sign(body,'different-synthetic-secret-'+'d'.repeat(32)),environment).authenticationAccepted).toBe(false);
 });
 it.each([undefined,'','0'.repeat(63),'0'.repeat(65),'z'.repeat(64),'sha256='+'a'.repeat(64)])('rejects missing or malformed signatures %#',signature=>{
  const result=diagnoseChapaWebhookSignature(body,signature,environment);expect(result.authenticationAccepted).toBe(false);expect(result.diagnosis).toBe(signature?'INVALID_SIGNATURE_FORMAT':'MISSING_SIGNATURE');
 });
 it('detects a legacy secret-on-secret constant only as a rejected delivery',()=>{
  expect(diagnoseChapaWebhookSignature(body,sign(secret),environment)).toMatchObject({authenticationAccepted:false,legacyConstantSignatureRejected:true,diagnosis:'LEGACY_CONSTANT_SIGNATURE_REJECTED'});
 });
 it('bounds body input and never returns private input or derived hashes',()=>{
  const signature=sign(body),result=diagnoseChapaWebhookSignature(body,signature,environment),output=JSON.stringify(result);
  for(const privateValue of [secret,signature,body.toString(),'private-fixture'])expect(output).not.toContain(privateValue);
  expect(diagnoseChapaWebhookSignature(Buffer.alloc(65537),signature,environment)).toMatchObject({bodyWithinLimit:false,authenticationAccepted:false,diagnosis:'RAW_BODY_TOO_LARGE'});
 });
});

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0)){const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('lowwin-webhook-signature-test-'))throw Error('Unexpected diagnostic fixture directory');rmSync(target,{recursive:true,force:true})}});
const script=fileURLToPath(new URL('../scripts/check-chapa-webhook-signature.ts',import.meta.url));
const tsx=createRequire(import.meta.url).resolve('tsx/cli');
function temporaryDirectory(){const directory=mkdtempSync(join(tmpdir(),'lowwin-webhook-signature-test-'));directories.push(directory);return directory}
function run(args:string[]=[],runtime:Record<string,string|undefined>=environment,cwd=process.cwd()){
 const env={...process.env,CHAPA_WEBHOOK_SECRET:undefined,...runtime};
 const result=spawnSync(process.execPath,[tsx,script,...args],{cwd,env,encoding:'utf8',timeout:10000});
 expect(result.error).toBeUndefined();return result;
}

describe('Signature diagnostic operator command',()=>{
 it('reports configuration without loading a local .env file',()=>{
  const directory=temporaryDirectory();writeFileSync(join(directory,'.env'),`CHAPA_WEBHOOK_SECRET=${secret}\n`);
  const result=run([],{},directory);expect(result.status).toBe(1);expect(JSON.parse(result.stdout)).toMatchObject({configurationValid:false,diagnosis:'MISSING_WEBHOOK_SECRET'});expect(result.stdout+result.stderr).not.toContain(secret);
 });
 it('validates exported exact bytes and a newline-terminated signature value',()=>{
  const directory=temporaryDirectory(),bodyFile=join(directory,'raw.bin'),signatureFile=join(directory,'signature.txt');
  writeFileSync(bodyFile,body);writeFileSync(signatureFile,sign(body)+'\n');
  const result=run(['--body-file',bodyFile,'--signature-file',signatureFile]);expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({authenticationAccepted:true,diagnosis:'MATCHES_RAW_BODY_SIGNATURE'});
  writeFileSync(bodyFile,Buffer.from(body.toString().trim()));
  const changed=run(['--body-file',bodyFile,'--signature-file',signatureFile]);expect(changed.status).toBe(1);expect(JSON.parse(changed.stdout).diagnosis).toBe('SIGNATURE_MISMATCH');
  for(const privateValue of [bodyFile,secret,sign(body),'private-fixture'])expect(result.stdout+result.stderr+changed.stdout+changed.stderr).not.toContain(privateValue);
 });
 it('rejects partial options and hides file error details',()=>{
  expect(JSON.parse(run(['--body-file','private-missing-path']).stderr).error).toBe('INVALID_OPTIONS');
  const result=run(['--body-file','private-missing-path','--signature-file','private-missing-signature']);
  expect(result.status).toBe(1);expect(JSON.parse(result.stderr).error).toBe('DIAGNOSTIC_FILE_UNAVAILABLE');expect(result.stdout+result.stderr).not.toContain('private-missing');
 });
 it('rejects oversized exports before hashing or showing their contents',()=>{
  const directory=temporaryDirectory(),bodyFile=join(directory,'oversized.bin'),signatureFile=join(directory,'signature.txt');writeFileSync(bodyFile,Buffer.alloc(65537,120));writeFileSync(signatureFile,sign(body));
  const result=run(['--body-file',bodyFile,'--signature-file',signatureFile]);expect(result.status).toBe(1);expect(JSON.parse(result.stderr).error).toBe('DIAGNOSTIC_FILE_TOO_LARGE');expect(result.stdout+result.stderr).not.toContain(bodyFile);
 });
});
