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
export function authLogSummary(args:unknown[],message?:unknown){
 const pending=[...args];let selected:ReturnType<typeof databaseErrorSummary>|undefined;
 let providerCode:string|undefined,diagnostic=typeof message==='string'?operations[message]:undefined;
 for(let visited=0;pending.length&&visited<12;visited++){
  const value=pending.shift();
  // The plugin intentionally throws a fixed sentence for a 200/error token
  // response. Extract only its allowlisted OAuth code, never the whole text.
  const text=typeof value==='string'?value:value instanceof Error?value.message:undefined;
  const tokenCode=text?.match(/^\[better-auth-telegram\] OIDC: token endpoint returned "([a-z_]+)"$/)?.[1];
  if(tokenCode&&providerCodes.has(tokenCode))providerCode=tokenCode;
  if(!value||typeof value!=='object')continue;
  if('code' in value&&typeof value.code==='string'&&providerCodes.has(value.code))providerCode=value.code;
  if('code' in value&&value.code==='SCHEMA_MISMATCH')diagnostic='GENERATED_CLIENT_SCHEMA';
  const summary=databaseErrorSummary(value);
  if(summary.code!=='UNKNOWN'||summary.sqlState||summary.reason){selected=summary;break}
  if('cause' in value)pending.push(value.cause);
  if('error' in value)pending.push(value.error);
 }
 if(selected)return {...selected,...(diagnostic?{diagnostic}:{})};
 if(providerCode)return {code:'AUTH_PROVIDER',diagnostic:diagnostic??'TOKEN_EXCHANGE',providerCode,hint:providerCode==='invalid_client'?'Check WEB Login Widget client credentials and exact BotFather callback; bot tokens are separate credentials.':'Restart sign-in; inspect the provider configuration if the rejection repeats.'};
 return {code:'AUTH_PROVIDER_OR_SESSION',...(diagnostic?{diagnostic}:{}),hint:'Run the read-only auth runtime check in WEB; inspect its generated-client, tables and runtime grants.'};
}
