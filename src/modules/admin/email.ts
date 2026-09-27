export type EmailMessage={to:string;subject:string;text:string};
export interface ServerEmailAdapter {send(message:EmailMessage):Promise<void>}
// The transport boundary has no production fallback and never logs links/tokens.
export function emailAdapter(raw:NodeJS.ProcessEnv=process.env):ServerEmailAdapter {
  const database=new URL(raw.DATABASE_URL??'postgresql://invalid'),sink=new URL(raw.EMAIL_SINK_URL??'http://invalid');
  if(raw.EMAIL_TRANSPORT!=='local-sink'||!['local','test'].includes(raw.APP_ENV??'')||raw.NODE_ENV==='production'||raw.VERCEL||!['127.0.0.1','localhost'].includes(database.hostname)||!database.pathname.endsWith('_test')||!['127.0.0.1','localhost'].includes(sink.hostname)||sink.protocol!=='http:')throw new Error('Email delivery unavailable: configure a production provider adapter before enabling staff invitations or reset.');
  return {async send(message){const response=await fetch(new URL('/mail',sink),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw new Error('Email delivery unavailable.')}};
}
