import {describe,expect,it,vi} from 'vitest';
import {exchangeTelegramBrowserCode,newBrowserLoginChallenge,telegramBrowserSettings,telegramTokenResponse} from '../src/modules/auth/telegram-browser-protocol';

const settings=telegramBrowserSettings({TELEGRAM_LOGIN_ENABLED:'true',TELEGRAM_LOGIN_CLIENT_ID:'123456789',TELEGRAM_LOGIN_CLIENT_SECRET:'synthetic-private-client-secret',TELEGRAM_BOT_TOKEN:'123456789:fixture_only_token',BETTER_AUTH_URL:'https://lowwin.test',APP_ENV:'production',NODE_ENV:'production'})!;
const privateMarker='private-provider-details-never-log';
describe('Telegram token endpoint response handling',()=>{
 it.each([
  {body:{error:'invalid_client',error_description:privateMarker},providerCode:'invalid_client',shape:'object'},
  {body:{error:'invalid_grant',access_token:privateMarker},providerCode:'invalid_grant',shape:'object'},
  {body:{error:privateMarker},providerCode:'unrecognized',shape:'object'},
  {body:{access_token:privateMarker},providerCode:'none',shape:'object'},
  {body:{data:{id_token:privateMarker}},providerCode:'none',shape:'object'},
  {body:{id_token:null},providerCode:'none',shape:'object'},
  {body:{id_token:1234},providerCode:'none',shape:'object'},
  {body:{id_token:''},providerCode:'none',shape:'object'},
  {body:null,providerCode:'none',shape:'null'},
  {body:[privateMarker],providerCode:'none',shape:'array'},
 ])('fails closed and retains only fixed response metadata: $shape/$providerCode',({body,providerCode,shape})=>{
  let caught:unknown;try{telegramTokenResponse(body,200)}catch(error){caught=error}
  expect(caught).toMatchObject({diagnostic:'TOKEN_RESPONSE',providerResponse:{httpStatus:200,providerCode,shape}});
  const logged=JSON.stringify(caught);expect(logged).not.toContain(privateMarker);expect(logged).not.toContain('error_description');
 });
 it('recognizes the documented top-level token, never a nested or access token fallback',()=>{
  expect(telegramTokenResponse({id_token:'signed-token-awaiting-verification',access_token:privateMarker},200)).toBe('signed-token-awaiting-verification');
  expect(()=>telegramTokenResponse({id_token:privateMarker,error:'invalid_request'},200)).toThrow();
  expect(()=>telegramTokenResponse({id_token:privateMarker},401)).toThrow();
 });
 it.each([200,400,401])('recognizes an OAuth error at HTTP %s without fetching JWKS or accepting identity',async status=>{
  const transport=vi.fn(async()=>Response.json({error:'invalid_client',error_description:privateMarker},{status})) as unknown as typeof fetch;
  const challenge=newBrowserLoginChallenge(settings,'/','en').challenge;
  await expect(exchangeTelegramBrowserCode('private-code',settings,challenge,transport)).rejects.toMatchObject({code:'unavailable',diagnostic:'TOKEN_RESPONSE',providerResponse:{httpStatus:status,providerCode:'invalid_client',hasError:true}});
  expect(transport).toHaveBeenCalledTimes(1);
 });
 it('still rejects a returned token that is not a signed Telegram JWT',async()=>{
  const transport=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith('/token')?Response.json({id_token:'unsigned-identity'}):Response.json({keys:[{kid:'fixture',kty:'RSA'}]})) as unknown as typeof fetch;
  const challenge=newBrowserLoginChallenge(settings,'/','en').challenge;
  await expect(exchangeTelegramBrowserCode('private-code',settings,challenge,transport)).rejects.toMatchObject({code:'invalid',diagnostic:'TOKEN_ENCODING'});
 });
});
