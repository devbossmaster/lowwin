import {createHash} from 'node:crypto';
import {z} from 'zod';
export type EmailMessage={to:string;subject:string;text:string};
export interface ServerEmailAdapter {send(message:EmailMessage):Promise<void>}
// The transport boundary has no production fallback and never logs links/tokens.
export function emailAdapter(raw:NodeJS.ProcessEnv=process.env):ServerEmailAdapter {
  if(raw.EMAIL_TRANSPORT==='resend') {
    const key=raw.RESEND_API_KEY,from=raw.EMAIL_FROM;
    if(!key||!/^re_[A-Za-z0-9_\-]+$/.test(key)||!from||!z.email().safeParse(from).success)throw new Error('Email delivery unavailable: configure RESEND_API_KEY and a verified EMAIL_FROM address.');
    return {async send(message){
      const payload={from,to:[z.email().parse(message.to)],subject:z.string().min(1).max(200).regex(/^[^\r\n]+$/).parse(message.subject),text:z.string().min(1).max(20000).parse(message.text)};
      const body=JSON.stringify(payload);
      // No provider response body, recipient, invitation or token is logged.
      // Stable idempotency prevents duplicate mail after an ambiguous network retry.
      try {
        const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':createHash('sha256').update(body).digest('hex')},body,signal:AbortSignal.timeout(5000),redirect:'error',cache:'no-store'});
        if(!response.ok)throw new Error();
        await response.body?.cancel();
      } catch {throw new Error('Email delivery unavailable. Retry later or contact the Owner.');}
    }};
  }
  const database=new URL(raw.DATABASE_URL??'postgresql://invalid'),sink=new URL(raw.EMAIL_SINK_URL??'http://invalid');
  if(raw.EMAIL_TRANSPORT!=='local-sink'||!['local','test'].includes(raw.APP_ENV??'')||raw.NODE_ENV==='production'||raw.VERCEL||!['127.0.0.1','localhost'].includes(database.hostname)||!database.pathname.endsWith('_test')||!['127.0.0.1','localhost'].includes(sink.hostname)||sink.protocol!=='http:')throw new Error('Email delivery unavailable: configure a production provider adapter before enabling staff invitations or reset.');
  return {async send(message){const response=await fetch(new URL('/mail',sink),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw new Error('Email delivery unavailable.')}};
}
