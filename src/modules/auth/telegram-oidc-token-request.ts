import type {BetterAuthPlugin} from 'better-auth';
import {validateAuthorizationCode} from 'better-auth/oauth2';
import type {TelegramLoginSettings} from './telegram-login';

/** better-auth-telegram 3.2.2 uses Basic auth, but core 1.7.17 omits the
 * documented client_id form field in that mode. Adapt only this request.
 * The upstream provider still owns PKCE/state, nonce and ID-token validation.
 * https://core.telegram.org/bots/telegram-login#exchange-code-for-tokens */
export function telegramOIDCTokenRequest(settings:TelegramLoginSettings|null):BetterAuthPlugin{
 return {id:'lowwin-telegram-token-request',init:context=>{
  if(!settings)return;
  return {context:{socialProviders:context.socialProviders.map(provider=>provider.id!=='telegram-oidc'?provider:{
   ...provider,
   validateAuthorizationCode:async({code,codeVerifier,redirectURI})=>{
    const tokens=await validateAuthorizationCode({code,codeVerifier,redirectURI,
     options:{clientId:settings.clientId,clientSecret:settings.clientSecret},
     tokenEndpoint:'https://oauth.telegram.org/token',authentication:'basic',
     additionalParams:{client_id:settings.clientId},
    });
    // Telegram can return HTTP 200 with an OAuth error instead of tokens.
    if(tokens.raw?.error)throw Error(`[better-auth-telegram] OIDC: token endpoint returned "${String(tokens.raw.error)}"`);
    return tokens;
   },
  })}};
 }};
}
