import {afterEach,describe,expect,it,vi} from 'vitest';
import {authorizationCodeRequest} from '@better-auth/core/oauth2';
import {TELEGRAM_OIDC_TOKEN_REQUEST_PROFILE,telegramOIDCTokenRequest,telegramOIDCTokenRequestOptions,telegramOIDCTokenRequestDiagnostics} from '../src/modules/auth/telegram-oidc-token-request';

const settings={clientId:'123456789',clientSecret:'synthetic-secret-only',origin:'https://lowwin.invalid',callback:'https://lowwin.invalid/api/auth/callback/telegram-oidc'};
const args={code:'synthetic-code',codeVerifier:'synthetic-verifier',redirectURI:settings.callback};
afterEach(()=>vi.unstubAllGlobals());
describe('Telegram documented token request compatibility',()=>{
 it('reproduces the installed core omission under Basic authentication',async()=>{
  const request=await authorizationCodeRequest({...args,options:settings,authentication:'basic'});
  expect(request.body.has('client_id')).toBe(false);
  expect(request.headers.authorization).toMatch(/^Basic /);
 });
 it('adds the documented public client ID, retaining Basic auth, PKCE and callback',async()=>{
  const fetch=vi.fn(async(_url,init)=>{
   const body=new URLSearchParams(init.body);
   expect(body.get('client_id')).toBe(settings.clientId);
   expect(body.get('code_verifier')).toBe(args.codeVerifier);
   expect(body.get('redirect_uri')).toBe(settings.callback);
   expect(body.has('client_secret')).toBe(false);
   expect([...new Headers(init.headers).keys()].filter(key=>key==='authorization')).toHaveLength(1);
   expect(new Headers(init.headers).get('authorization')).toBe('Basic '+Buffer.from(settings.clientId+':'+settings.clientSecret).toString('base64'));
   return Response.json({access_token:'synthetic-access',id_token:'synthetic-token',token_type:'Bearer'});
  });
  vi.stubGlobal('fetch',fetch);
  const verify=vi.fn(),getUserInfo=vi.fn(async()=>null),other={id:'other-provider'};
  const result=await telegramOIDCTokenRequest(settings).init!({socialProviders:[{id:'telegram-oidc',idToken:{verify},getUserInfo},other]} as never);
  const providers=result!.context!.socialProviders!;
  expect(providers[1]).toBe(other);
  expect(providers[0]!.idToken).toEqual({verify});
  const verifiedTokens={idToken:'synthetic-token',expectedIdTokenNonce:'original-nonce'};expect(await providers[0]!.getUserInfo!(verifiedTokens as never)).toBeNull();expect(getUserInfo).toHaveBeenCalledExactlyOnceWith(verifiedTokens);
  expect(await providers[0]!.validateAuthorizationCode!(args)).toMatchObject({idToken:'synthetic-token'});
  expect(fetch).toHaveBeenCalledOnce();
 });
 it.each(['synthetic-secret-only','synthetic~secret','synthetic:secret','synthetic+secret','synthetic/secret','synthetic-ሚስጥር-秘密'])('sends the documented raw UTF-8 Basic pair for %s',async clientSecret=>{
  const configured={...settings,clientSecret};
  const fetch=vi.fn(async(url,init)=>{
   expect(String(url)).toBe('https://oauth.telegram.org/token');expect(init.method).toBe('POST');
   const headers=new Headers(init.headers),body=new URLSearchParams(init.body);
   expect(headers.get('authorization')).toBe('Basic '+Buffer.from(configured.clientId+':'+clientSecret,'utf8').toString('base64'));
   expect([...headers.keys()].filter(key=>key==='authorization')).toHaveLength(1);
   expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
   expect(body.get('client_id')).toBe(settings.clientId);expect(body.get('grant_type')).toBe('authorization_code');
   expect(body.get('redirect_uri')).toBe(args.redirectURI);expect(body.get('code_verifier')).toBe(args.codeVerifier);expect(body.get('code')).toBe(args.code);
   expect(body.has('client_secret')).toBe(false);
   return Response.json({id_token:'synthetic-token',access_token:'synthetic-access',token_type:'Bearer'});
  });
  vi.stubGlobal('fetch',fetch);
  const result=await telegramOIDCTokenRequest(configured).init!({socialProviders:[{id:'telegram-oidc'}]} as never);
  await expect(result!.context!.socialProviders![0]!.validateAuthorizationCode!(args)).resolves.toMatchObject({idToken:'synthetic-token'});
  expect(fetch).toHaveBeenCalledOnce();
 });
 it('replaces conflicting authorization casing with one credential header in the shared builder',async()=>{
  const request=await authorizationCodeRequest({...telegramOIDCTokenRequestOptions(settings,args),headers:{Authorization:'Basic old-value',authorization:'Basic other-value',AUTHORIZATION:'Basic third-value'}});
  expect(Object.keys(request.headers).filter(key=>key.toLowerCase()==='authorization')).toEqual(['authorization']);
  expect(request.headers.authorization).toBe('Basic '+Buffer.from(settings.clientId+':'+settings.clientSecret).toString('base64'));
 });
 it('builds redacted diagnostics from the same request path without making any HTTP request',async()=>{
  const fetch=vi.fn(()=>{throw Error('Diagnostics must not use HTTP')});vi.stubGlobal('fetch',fetch);
  const configured={...settings,clientSecret:'synthetic~:秘密+secret/'};
  const result=await telegramOIDCTokenRequestDiagnostics(configured);
  expect(result).toEqual({profile:TELEGRAM_OIDC_TOKEN_REQUEST_PROFILE,basicHeaderMatches:true,clientIdInBody:true,redirectMatches:true,pkcePresent:true,secretInBody:false});
  expect(Object.values(result).filter(value=>typeof value!=='boolean')).toEqual([TELEGRAM_OIDC_TOKEN_REQUEST_PROFILE]);
  expect(JSON.stringify(result)).not.toContain(configured.clientSecret);expect(JSON.stringify(result)).not.toContain(settings.callback);expect(JSON.stringify(result)).not.toContain(settings.clientId);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('does not treat HTTP 200 OAuth rejection as authentication success',async()=>{
  const fetch=vi.fn(async()=>Response.json({error:'invalid_client'}));vi.stubGlobal('fetch',fetch);
  const result=await telegramOIDCTokenRequest(settings).init!({socialProviders:[{id:'telegram-oidc'}]} as never);
  const exchange=result!.context!.socialProviders![0]!.validateAuthorizationCode!(args);
  await expect(exchange).rejects.toThrow('invalid_client');
  await expect(exchange).rejects.toMatchObject({telegramTokenRequestProfile:TELEGRAM_OIDC_TOKEN_REQUEST_PROFILE});
  expect(fetch).toHaveBeenCalledOnce();
 });
 it('does not change Mini App or disabled browser login configuration',()=>{
  expect(telegramOIDCTokenRequest(null).init!({} as never)).toBeUndefined();
 });
});
