import type {BetterAuthPlugin} from 'better-auth';
import {Buffer} from 'node:buffer';
import {authorizationCodeRequest,validateAuthorizationCode} from 'better-auth/oauth2';
import type {TelegramLoginSettings} from './telegram-login';

export const TELEGRAM_OIDC_TOKEN_REQUEST_PROFILE='telegram-basic-raw-v2' as const;
type CodeArguments=Pick<Parameters<typeof validateAuthorizationCode>[0],'code'|'codeVerifier'|'redirectURI'>;
const basicHeader=(settings:TelegramLoginSettings)=>'Basic '+Buffer.from(`${settings.clientId}:${settings.clientSecret}`,'utf8').toString('base64');

/** Telegram documents the UTF-8 client_id:client_secret pair directly in Basic
 * auth, plus client_id in the form. Core's generic Basic strategy percent-
 * encodes credentials and omits that form field. Customize only this request;
 * The upstream provider still owns PKCE/state, nonce and ID-token validation.
 * https://core.telegram.org/bots/telegram-login#exchange-code-for-tokens */
export function telegramOIDCTokenRequestOptions(settings:TelegramLoginSettings,args:CodeArguments):Parameters<typeof validateAuthorizationCode>[0]{
 return {...args,options:{clientId:settings.clientId,clientSecret:settings.clientSecret},
  tokenEndpoint:'https://oauth.telegram.org/token',additionalParams:{client_id:settings.clientId},
  tokenEndpointAuth:{method:'custom',customizeRequest:({body,headers})=>{
   if(body.has('client_secret'))throw Error('Telegram token request must not include client_secret in its form');
   // Avoid duplicate Authorization values even if a caller changes casing.
   for(const key of Object.keys(headers))if(key.toLowerCase()==='authorization')delete headers[key];
   headers.authorization=basicHeader(settings);
  }},
 };
}

/** Construct the actual core request with synthetic code/PKCE, without HTTP.
 * Return fixed metadata and booleans only, never headers, credentials or URLs. */
export async function telegramOIDCTokenRequestDiagnostics(settings:TelegramLoginSettings){
 const verifier='lowwin-diagnostic-pkce-never-sent';
 const request=await authorizationCodeRequest(telegramOIDCTokenRequestOptions(settings,{code:'lowwin-diagnostic-code-never-sent',codeVerifier:verifier,redirectURI:settings.callback}));
 return {profile:TELEGRAM_OIDC_TOKEN_REQUEST_PROFILE,
  basicHeaderMatches:new Headers(request.headers).get('authorization')===basicHeader(settings),
  clientIdInBody:request.body.get('client_id')===settings.clientId,
  redirectMatches:request.body.get('redirect_uri')===settings.callback,
  pkcePresent:request.body.get('code_verifier')===verifier,
  secretInBody:request.body.has('client_secret')||[...request.body.values()].includes(settings.clientSecret),
 };
}

export function telegramOIDCTokenRequest(settings:TelegramLoginSettings|null):BetterAuthPlugin{
 return {id:'lowwin-telegram-token-request',init:context=>{
  if(!settings)return;
  return {context:{socialProviders:context.socialProviders.map(provider=>provider.id!=='telegram-oidc'?provider:{
   ...provider,
   validateAuthorizationCode:async({code,codeVerifier,redirectURI})=>{
    const tokens=await validateAuthorizationCode(telegramOIDCTokenRequestOptions(settings,{code,codeVerifier,redirectURI}));
    // Telegram can return HTTP 200 with an OAuth error instead of tokens.
    if(tokens.raw?.error)throw Object.assign(Error(`[better-auth-telegram] OIDC: token endpoint returned "${String(tokens.raw.error)}"`),{telegramTokenRequestProfile:TELEGRAM_OIDC_TOKEN_REQUEST_PROFILE});
    return tokens;
   },
  })}};
 }};
}
