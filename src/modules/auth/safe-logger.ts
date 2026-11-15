import {databaseErrorSummary} from '@/lib/database-error';

/** Better Auth may include tokens, SQL and PII in messages/arguments. Only
 * known diagnostic codes may leave this boundary. Never print those values. */
const providerCodes=new Set(['invalid_client','invalid_grant','invalid_request','unauthorized_client','unsupported_grant_type','temporarily_unavailable','server_error']);
const operations:Record<string,string>={
 'Failed to validate authorization code':'TOKEN_EXCHANGE',
 'Unable to get user info':'TOKEN_VALIDATION',
 'Failed to create verification':'STATE_CREATE',
 'State not found':'STATE_LOOKUP',
 'Failed to parse state':'STATE_PARSE',
 'OAuth issuer mismatch':'TOKEN_ISSUER',
 'OAuth id_token nonce binding required but no expected nonce was found in state':'TOKEN_NONCE',
 'Could not validate the database schema. Check your database connection.':'DATABASE_SCHEMA',
};
const stateCodes=new Set(['state_not_found','state_mismatch','state_security_mismatch','state_invalid']);
const stateFailures:Record<string,{reason:string;hint:string}>={
 'State not found in OAuth callback':{reason:'MISSING_STATE_PARAMETER',hint:'Start a fresh sign-in from LowWin; do not reopen a callback URL.'},
 'State mismatch: auth state cookie not found':{reason:'STATE_COOKIE_MISSING',hint:'Retry in the same browser. Check the canonical origin and state-cookie delivery if it repeats.'},
 'State invalid: Failed to decrypt or parse auth state':{reason:'STORED_STATE_INVALID',hint:'Start a fresh sign-in. Check stable BETTER_AUTH_SECRET across WEB replicas if it repeats.'},
 'State mismatch: OAuth state parameter does not match stored state':{reason:'STATE_VALUE_MISMATCH',hint:'Start a fresh sign-in and avoid concurrent sign-in tabs.'},
 'State mismatch: verification not found':{reason:'STATE_RECORD_MISSING',hint:'Start a fresh sign-in. If a new attempt fails immediately, check WEB database consistency and verification storage.'},
 'State mismatch: State not persisted correctly':{reason:'STATE_COOKIE_BINDING_MISMATCH',hint:'Retry in the same browser. Check canonical origin, state-cookie delivery and stable BETTER_AUTH_SECRET across WEB replicas if it repeats.'},
 'Invalid state: request expired':{reason:'STATE_EXPIRED',hint:'Sign-in expired. Start a fresh sign-in.'},
};
const unknownStateHint='Sign-in state could not be validated. Start a fresh sign-in; inspect state diagnostics if it repeats.';
export function authLogSummary(args:unknown[],message?:unknown){
 const pending=[...args];let selected:ReturnType<typeof databaseErrorSummary>|undefined;
 let providerCode:string|undefined,tokenRequestProfile:string|undefined,stateCode:string|undefined,stateFailure:{reason:string;hint:string}|undefined,diagnostic=typeof message==='string'?operations[message]:undefined;
 for(let visited=0;pending.length&&visited<12;visited++){
  const value=pending.shift();
  // The plugin intentionally throws a fixed sentence for a 200/error token
  // response. Extract only its allowlisted OAuth code, never the whole text.
  const text=typeof value==='string'?value:value instanceof Error?value.message:undefined;
  const tokenCode=text?.match(/^\[better-auth-telegram\] OIDC: token endpoint returned "([a-z_]+)"$/)?.[1];
  if(tokenCode&&providerCodes.has(tokenCode))providerCode=tokenCode;
  if(!value||typeof value!=='object')continue;
  if('telegramTokenRequestProfile' in value&&value.telegramTokenRequestProfile==='telegram-basic-raw-v2')tokenRequestProfile='telegram-basic-raw-v2';
  if('code' in value&&typeof value.code==='string'&&providerCodes.has(value.code))providerCode=value.code;
  if('code' in value&&typeof value.code==='string'&&stateCodes.has(value.code)){
   stateCode=value.code;
   // Match only fixed installed-core sentences. StateError.details can hold
   // OAuth state, and nested parser errors can contain persisted JSON.
   if(text&&Object.hasOwn(stateFailures,text))stateFailure=stateFailures[text];
  }
  if('code' in value&&value.code==='SCHEMA_MISMATCH')diagnostic='GENERATED_CLIENT_SCHEMA';
  const summary=databaseErrorSummary(value);
  if(summary.code!=='UNKNOWN'||summary.sqlState||summary.reason){selected=summary;break}
  if('cause' in value)pending.push(value.cause);
  if('error' in value)pending.push(value.error);
 }
 if(selected)return {...selected,...(diagnostic?{diagnostic}:{}),...(tokenRequestProfile?{tokenRequestProfile}:{})};
 if(diagnostic==='STATE_PARSE'||stateCode)return {code:'AUTH_STATE',diagnostic:diagnostic??'STATE_PARSE',...(stateCode?{stateCode}:{}),...(stateFailure?{reason:stateFailure.reason}:{}),hint:stateFailure?.hint??unknownStateHint};
 if(providerCode)return {code:'AUTH_PROVIDER',diagnostic:diagnostic??'TOKEN_EXCHANGE',providerCode,...(tokenRequestProfile?{tokenRequestProfile}:{}),hint:providerCode==='invalid_client'?'Telegram rejected WEB OIDC client authentication. Check the current Login Widget Client ID/Secret pair for this bot; worker credentials do not configure WEB.':'Restart sign-in; inspect the provider configuration if the rejection repeats.'};
 return {code:'AUTH_PROVIDER_OR_SESSION',...(diagnostic?{diagnostic}:{}),hint:'Run the read-only auth runtime check in WEB; inspect its generated-client, tables and runtime grants.'};
}
