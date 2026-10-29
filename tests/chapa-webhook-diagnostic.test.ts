import {describe,expect,it} from 'vitest';
import {diagnoseChapaWebhookAuthorization} from '../src/modules/payments/chapa-webhook-diagnostic';

const environment={CHAPA_WEBHOOK_AUTH:'basic',CHAPA_WEBHOOK_BASIC_USERNAME:'operator-fixture',CHAPA_WEBHOOK_BASIC_PASSWORD:'fixture-password-abc123'};
const basic=(username=environment.CHAPA_WEBHOOK_BASIC_USERNAME,password=environment.CHAPA_WEBHOOK_BASIC_PASSWORD)=>'Basic '+Buffer.from(`${username}:${password}`).toString('base64');

describe('read-only Chapa webhook authentication diagnosis',()=>{
 it('uses the production authenticator for matching Basic credentials',()=>{
  expect(diagnoseChapaWebhookAuthorization(basic(),environment)).toMatchObject({configuredAuth:'basic',configurationValid:true,canonicalBasicFormat:true,usernameMatches:true,passwordMatches:true,authenticationAccepted:true,diagnosis:'MATCHES_DEPLOYED_BASIC_AUTH'});
 });
 it.each(['Authorization','authorization','AUTHORIZATION'])('reads a copied %s JSON field',key=>{
  expect(diagnoseChapaWebhookAuthorization(JSON.stringify({[key]:basic(),'Content-Type':'application/json'}),environment).authenticationAccepted).toBe(true);
 });
 it('accepts a copied Authorization header line',()=>{
  expect(diagnoseChapaWebhookAuthorization('Authorization: '+basic(),environment).authenticationAccepted).toBe(true);
 });
 it('distinguishes username, password, scheme and configuration mismatch without outputting values',()=>{
  expect(diagnoseChapaWebhookAuthorization(basic('another-operator'),environment).diagnosis).toBe('USERNAME_MISMATCH');
  expect(diagnoseChapaWebhookAuthorization(basic(undefined,'another-password-123'),environment).diagnosis).toBe('PASSWORD_MISMATCH');
  expect(diagnoseChapaWebhookAuthorization('Bearer private-fixture',environment).diagnosis).toBe('AUTH_SCHEME_MISMATCH');
  expect(diagnoseChapaWebhookAuthorization(basic(),{...environment,CHAPA_WEBHOOK_BASIC_PASSWORD:'short'}).diagnosis).toBe('INVALID_AUTH_CONFIGURATION');
 });
 it.each(['','{','[]','Basic !!!','Basic Zg','Basic '+Buffer.from('no-separator').toString('base64'),JSON.stringify({Authorization:basic(),authorization:basic()}),JSON.stringify({Authorization:123})])('handles malformed header input %#',input=>{
  const result=diagnoseChapaWebhookAuthorization(input,environment);expect(result.authenticationAccepted).toBe(false);expect(result.diagnosis).not.toBe('MATCHES_DEPLOYED_BASIC_AUTH');
 });
 it('recognizes an encrypted password envelope but never accepts it as a fallback',()=>{
  const wrapper=Buffer.from(JSON.stringify({iv:'fixture-iv',value:'fixture-ciphertext',mac:'fixture-mac',tag:''})).toString('base64');
  const result=diagnoseChapaWebhookAuthorization(basic(undefined,wrapper),environment);
  expect(result).toMatchObject({usernameMatches:true,passwordMatches:false,passwordLooksEncrypted:true,authenticationAccepted:false,diagnosis:'RECEIVED_PASSWORD_ENVELOPE_MISMATCH'});
  const output=JSON.stringify(result);for(const secret of [environment.CHAPA_WEBHOOK_BASIC_USERNAME,environment.CHAPA_WEBHOOK_BASIC_PASSWORD,wrapper,'fixture-ciphertext',basic(undefined,wrapper)])expect(output).not.toContain(secret);
 });
 it('preserves the production header length limit',()=>{
  expect(diagnoseChapaWebhookAuthorization(basic(undefined,'p'.repeat(500)),environment)).toMatchObject({headerTooLong:true,authenticationAccepted:false,diagnosis:'AUTHORIZATION_TOO_LONG'});
 });
 it('does not guess whether Signature authentication would succeed',()=>{
  expect(diagnoseChapaWebhookAuthorization(basic(),{CHAPA_WEBHOOK_AUTH:'signature'})).toMatchObject({configuredAuth:'signature',authenticationAccepted:null,diagnosis:'SIGNATURE_REQUIRES_EXACT_RAW_BODY'});
 });
 it('rejects excessive input without printing it',()=>{
  const result=diagnoseChapaWebhookAuthorization('a'.repeat(8193),environment);expect(result.diagnosis).toBe('INPUT_TOO_LARGE');expect(JSON.stringify(result)).not.toContain('aaaa');
 });
 it('does not trim or normalize the decoded password',()=>{
  expect(diagnoseChapaWebhookAuthorization(basic(undefined,environment.CHAPA_WEBHOOK_BASIC_PASSWORD+' '),environment).authenticationAccepted).toBe(false);
 });
});
