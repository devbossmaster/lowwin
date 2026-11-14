import {databaseErrorSummary} from '@/lib/database-error';

/** Better Auth may include tokens, SQL and PII in messages/arguments. Only
 * known diagnostic codes may leave this boundary. Never print those values. */
export function authLogSummary(args:unknown[]){
 const pending=[...args];let selected:ReturnType<typeof databaseErrorSummary>|undefined;
 for(let visited=0;pending.length&&visited<12;visited++){
  const value=pending.shift();if(!value||typeof value!=='object')continue;
  const summary=databaseErrorSummary(value);
  if(summary.code!=='UNKNOWN'||summary.sqlState||summary.reason){selected=summary;break}
  if('cause' in value)pending.push(value.cause);
  if('error' in value)pending.push(value.error);
 }
 return selected??{code:'AUTH_PROVIDER_OR_SESSION',hint:'Check Telegram sign-in diagnostics and WEB database readiness.'};
}
