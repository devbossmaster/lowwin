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
});
