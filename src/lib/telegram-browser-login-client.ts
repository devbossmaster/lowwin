import {miniReturnPath} from './mini-return';
import {customerLoginRequest} from './customer-login-entry';

export const TELEGRAM_BROWSER_LOGIN_ERRORS=['cancelled','expired','unavailable','invalid','contact_required','conflict'] as const;
export type TelegramBrowserLoginError=typeof TELEGRAM_BROWSER_LOGIN_ERRORS[number];
export type TelegramEnvironment='detecting'|'mini'|'browser';
export type TelegramBrowserLoginConfiguration={enabled:boolean;configured:boolean};
function readResponseJson(response:Response,signal:AbortSignal):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new DOMException('Aborted','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){signal.removeEventListener('abort',abort);abort();return}
  response.json().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}

/** Presentation only. Server authentication never trusts SDK globals or URL hints. */
export function telegramEnvironment(app:{initData?:string}|undefined):Exclude<TelegramEnvironment,'detecting'>{
 return app?.initData?'mini':'browser';
}
/** A launch URL may arrive before Telegram's SDK. This controls presentation
 * only; neither a hint nor SDK presence authenticates a customer. */
export function telegramMiniLaunchHint(location:{search:string;hash:string}):boolean{
 for(const source of [location.search.replace(/^\?/,''),location.hash.replace(/^#/, '')]){
  const params=new URLSearchParams(source);
  if(params.get('tgWebAppData')?.trim()||params.get('tgWebAppPlatform')&&params.get('tgWebAppPlatform')!=='unknown')return true;
 }
 return false;
}
export function telegramBrowserLoginError(value:string|null):TelegramBrowserLoginError|null{
 return TELEGRAM_BROWSER_LOGIN_ERRORS.includes(value as TelegramBrowserLoginError)?value as TelegramBrowserLoginError:null;
}
export function telegramBrowserLoginDestination(location:{pathname:string;search:string;hash:string}):string{
 const query=new URLSearchParams(location.search);
 if(location.pathname==='/'){
  const requested=customerLoginRequest(query);if(requested)return requested.destination;
  const errors=query.getAll('telegramLoginError');
  if(errors.length===1&&telegramBrowserLoginError(errors[0])&&query.getAll('next').length===1)return miniReturnPath(query.get('next'));
  query.delete('next');
 }
 query.delete('login');
 query.delete('telegramLoginError');
 const search=query.toString();
 return miniReturnPath(location.pathname+(search?'?'+search:'')+location.hash);
}
/** Better Auth owns state, PKCE, code exchange and cookies. The browser only
 * starts the same-origin command and follows the expected Telegram approval URL. */
export async function requestTelegramBrowserLogin(next:string,language:'en'|'am',signal:AbortSignal,transport:typeof fetch=fetch,timeoutMs=8000):Promise<string>{
 const controller=new AbortController(),abort=()=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();
 const timeout=setTimeout(abort,timeoutMs),destination=miniReturnPath(next);
 try{
  const response=await transport('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',signal:controller.signal,body:JSON.stringify({provider:'telegram-oidc',callbackURL:destination,errorCallbackURL:'/?'+new URLSearchParams({login:'1',next:destination,lang:language}).toString(),disableRedirect:true})});
  if(!response.ok)throw Error('Sign-in unavailable');
  const result=await readResponseJson(response,controller.signal);
  if(!result||typeof result!=='object'||!('url'in result)||typeof result.url!=='string'||!('redirect'in result)||result.redirect!==true)throw Error('Sign-in unavailable');
  const url=new URL(result.url);
  if(url.origin!=='https://oauth.telegram.org'||url.pathname!=='/auth'||url.username||url.password||url.hash)throw Error('Sign-in unavailable');
  return url.href;
 }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
}
