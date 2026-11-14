import {afterEach,describe,expect,it,vi} from 'vitest';
import {authorizationCodeRequest} from '@better-auth/core/oauth2';
import {telegramOIDCTokenRequest} from '../src/modules/auth/telegram-oidc-token-request';

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
   expect(new Headers(init.headers).get('authorization')).toBe('Basic '+Buffer.from(settings.clientId+':'+settings.clientSecret).toString('base64'));
   return Response.json({access_token:'synthetic-access',id_token:'synthetic-token',token_type:'Bearer'});
  });
  vi.stubGlobal('fetch',fetch);
  const verify=vi.fn(),getUserInfo=vi.fn(),other={id:'other-provider'};
  const result=await telegramOIDCTokenRequest(settings).init!({socialProviders:[{id:'telegram-oidc',idToken:{verify},getUserInfo},other]} as never);
  const providers=result!.context!.socialProviders!;
  expect(providers[1]).toBe(other);
  expect(providers[0]!.idToken).toEqual({verify});expect(providers[0]!.getUserInfo).toBe(getUserInfo);
  expect(await providers[0]!.validateAuthorizationCode!(args)).toMatchObject({idToken:'synthetic-token'});
  expect(fetch).toHaveBeenCalledOnce();
 });
 it('does not treat HTTP 200 OAuth rejection as authentication success',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'invalid_client'})));
  const result=await telegramOIDCTokenRequest(settings).init!({socialProviders:[{id:'telegram-oidc'}]} as never);
  await expect(result!.context!.socialProviders![0]!.validateAuthorizationCode!(args)).rejects.toThrow('invalid_client');
 });
 it('does not change Mini App or disabled browser login configuration',()=>{
  expect(telegramOIDCTokenRequest(null).init!({} as never)).toBeUndefined();
 });
});
