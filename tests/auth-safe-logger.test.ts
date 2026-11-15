import {describe,expect,it} from 'vitest';
import {authLogSummary} from '../src/modules/auth/safe-logger';
describe('safe Better Auth diagnostics',()=>{
 it('keeps a known database code while dropping SQL, tokens and personal fields',()=>{
  const result=authLogSummary([{code:'P1001',name:'PrismaClientInitializationError',message:'secret-token postgres://private@example',meta:{query:'private SQL'},phone:'+251911111111'}]);
  expect(result).toMatchObject({code:'P1001',kind:'PrismaClientInitializationError'});
  expect(JSON.stringify(result)).not.toMatch(/secret-token|postgres:|private SQL|251911111111/);
 });
 it('finds nested causes and bounds cyclic failures',()=>{
  expect(authLogSummary([{cause:{error:{code:'P2024'}}}])).toMatchObject({code:'P2024'});
  const error:{cause?:unknown}={};error.cause=error;expect(authLogSummary([error])).toMatchObject({code:'AUTH_PROVIDER_OR_SESSION'});
 });
 it('does not print arbitrary provider messages or unknown codes',()=>{
  const result=authLogSummary(['Bearer private-token',{code:'private-value',message:'user@example.com',stack:'sensitive stack'}]);
  expect(result).toMatchObject({code:'AUTH_PROVIDER_OR_SESSION'});expect(JSON.stringify(result)).not.toMatch(/private-token|private-value|user@example|sensitive stack/);
 });
 it('keeps the fixed auth stage when upstream supplies no exception argument',()=>{
  expect(authLogSummary([],'Unable to get user info')).toMatchObject({diagnostic:'TOKEN_VALIDATION'});
  expect(authLogSummary([],'Failed to create verification')).toMatchObject({diagnostic:'STATE_CREATE'});
  expect(JSON.stringify(authLogSummary([],'Invalid origin: https://private.example/?token=secret'))).not.toContain('private.example');
 });
 it('extracts allowlisted token rejection codes without provider payloads',()=>{
  expect(authLogSummary([new Error('[better-auth-telegram] OIDC: token endpoint returned "invalid_client"')],'Failed to validate authorization code')).toMatchObject({code:'AUTH_PROVIDER',diagnostic:'TOKEN_EXCHANGE',providerCode:'invalid_client'});
  expect(JSON.stringify(authLogSummary([new Error('[better-auth-telegram] OIDC: token endpoint returned "private-token"')]))).not.toContain('private-token');
 });
 it('retains database evidence ahead of a generic provider failure',()=>{
  expect(authLogSummary([{cause:{code:'P2022'}}],'Failed to create verification')).toMatchObject({code:'P2022',diagnostic:'STATE_CREATE'});
 });
 it('reports only the known token-request profile without secret request data',()=>{
  const failure=Object.assign(new Error('[better-auth-telegram] OIDC: token endpoint returned "invalid_client"'),{telegramTokenRequestProfile:'telegram-basic-raw-v2',authorization:'Basic secret-header',body:'code=secret-code&client_secret=private'});
  expect(authLogSummary([failure],'Failed to validate authorization code')).toMatchObject({providerCode:'invalid_client',diagnostic:'TOKEN_EXCHANGE',tokenRequestProfile:'telegram-basic-raw-v2'});
  expect(JSON.stringify(authLogSummary([failure]))).not.toMatch(/secret-header|secret-code|client_secret=private/);
  expect(authLogSummary([{telegramTokenRequestProfile:'private-secret-value',code:'invalid_client'}])).not.toHaveProperty('tokenRequestProfile');
 });
 it.each([
  ['state_mismatch','State mismatch: verification not found','STATE_RECORD_MISSING'],
  ['state_security_mismatch','State mismatch: State not persisted correctly','STATE_COOKIE_BINDING_MISMATCH'],
  ['state_mismatch','State mismatch: auth state cookie not found','STATE_COOKIE_MISSING'],
  ['state_not_found','State not found in OAuth callback','MISSING_STATE_PARAMETER'],
  ['state_mismatch','Invalid state: request expired','STATE_EXPIRED'],
  ['state_security_mismatch','State mismatch: OAuth state parameter does not match stored state','STATE_VALUE_MISMATCH'],
  ['state_invalid','State invalid: Failed to decrypt or parse auth state','STORED_STATE_INVALID'],
 ])('identifies a fixed state failure without reflecting its details: %s / %s',(stateCode,message,reason)=>{
  const failure=Object.assign(new Error(message),{code:stateCode,details:{state:'private-oauth-state',cookie:'secret-cookie',value:'private-persisted-json'},errorURL:'https://lowwin.example/?secret=private-callback'});
  const result=authLogSummary([failure],'Failed to parse state');
  expect(result).toMatchObject({code:'AUTH_STATE',diagnostic:'STATE_PARSE',stateCode,reason});
  expect(JSON.stringify(result)).not.toMatch(/private-oauth-state|secret-cookie|private-persisted-json|private-callback/);
 });
 it('does not infer database failure when state parsing has no recognized cause',()=>{
  const result=authLogSummary([new SyntaxError('JSON contains private-state and private-cookie')],'Failed to parse state');
  expect(result).toMatchObject({code:'AUTH_STATE',diagnostic:'STATE_PARSE'});
  expect(result).not.toHaveProperty('stateCode');expect(result).not.toHaveProperty('reason');
  expect(result.hint).not.toMatch(/database|grants|schema/i);
  expect(JSON.stringify(result)).not.toMatch(/private-state|private-cookie/);
 });
 it('keeps known nested database evidence above a state failure',()=>{
  const failure=Object.assign(new Error('State mismatch: verification not found'),{code:'state_mismatch',details:{state:'private-state'},cause:{code:'P2022',message:'private-query',meta:{code:'42703'}}});
  expect(authLogSummary([failure],'Failed to parse state')).toMatchObject({code:'P2022',sqlState:'42703',diagnostic:'STATE_PARSE'});
  expect(JSON.stringify(authLogSummary([failure],'Failed to parse state'))).not.toMatch(/private-state|private-query/);
 });
 it('does not trust an arbitrary state code or append a provider message to the hint',()=>{
  const failure=Object.assign(new Error('private-state-value'),{code:'state_security_mismatch',details:{state:'private-details'}});
  expect(authLogSummary([failure],'Failed to parse state')).toMatchObject({code:'AUTH_STATE',stateCode:'state_security_mismatch'});
  expect(authLogSummary([failure],'Failed to parse state')).not.toHaveProperty('reason');
  const unknown=authLogSummary([{code:'private-state-code',details:'private-details'}],'Failed to parse state');
  expect(unknown).not.toHaveProperty('stateCode');
  expect(JSON.stringify([unknown,authLogSummary([failure],'Failed to parse state')])).not.toMatch(/private-state-value|private-details|private-state-code/);
 });
});
