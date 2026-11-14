import {miniReturnPath} from '@/lib/mini-return';

export const TELEGRAM_LOGIN_PROVIDER='telegram-oidc';
export const TELEGRAM_LOGIN_MIGRATION='202611130002_telegram_browser_login';
export type TelegramLoginSettings={clientId:string;clientSecret:string;origin:string;callback:string};

/** Configuration only. Better Auth + better-auth-telegram own the OIDC protocol. */
export function telegramLoginSettings(raw:Record<string,string|undefined>=process.env):TelegramLoginSettings|null{
 if(raw.TELEGRAM_LOGIN_ENABLED!=='true')return null;
 const clientId=raw.TELEGRAM_LOGIN_CLIENT_ID??'',clientSecret=raw.TELEGRAM_LOGIN_CLIENT_SECRET??'';
 if(!/^\d{1,20}$/.test(clientId)||clientId!==raw.TELEGRAM_BOT_TOKEN?.split(':')[0]||clientSecret.length<16||clientSecret.length>512||/\s/.test(clientSecret)||/^["']|["']$/.test(clientSecret))return null;
 try{
  const url=new URL(raw.BETTER_AUTH_URL??'');
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')return null;
  if(url.protocol!=='https:'&&(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['local','test'].includes(raw.APP_ENV??'')||raw.NODE_ENV==='production'||raw.VERCEL))return null;
  return {clientId,clientSecret,origin:url.origin,callback:url.origin+'/api/auth/callback/'+TELEGRAM_LOGIN_PROVIDER};
 }catch{return null}
}
export function browserLoginConfig(raw:Record<string,string|undefined>=process.env){
 const configured=!!telegramLoginSettings({...raw,TELEGRAM_LOGIN_ENABLED:'true'});
 return {enabled:raw.TELEGRAM_LOGIN_ENABLED==='true'&&configured,configured};
}

/** The proxy must retain canonical Host; forwarded headers cannot establish it. */
export function telegramLoginRequestOrigin(request:Request,origin:string){
 try{
  const canonical=new URL(origin),transport=new URL(request.url);
  const validHost=(value:string)=>!/[\s,/@?#\\\u0000-\u001f\u007f]/.test(value)&&new URL(canonical.protocol+'//'+value).host===canonical.host;
  const host=request.headers.get('host'),forwarded=request.headers.get('x-forwarded-host'),protocol=request.headers.get('x-forwarded-proto');
  if(host!==null&&!validHost(host)||forwarded!==null&&!validHost(forwarded)||protocol!==null&&protocol!==canonical.protocol.slice(0,-1))return false;
  return transport.origin===origin||host!==null&&validHost(host);
 }catch{return false}
}
export function telegramLoginDestination(value:unknown,origin:string){
 if(typeof value!=='string')return null;
 try{
  const url=new URL(value,origin),path=url.pathname+url.search+url.hash;
  return url.origin===origin&&miniReturnPath(path)===path?path:null;
 }catch{return null}
}
export function telegramLoginFailure(code:string|null){
 if(code==='access_denied')return 'cancelled';
 if(['state_not_found','state_expired'].includes(code??''))return 'expired';
 if(['contact_required','conflict'].includes(code??''))return code!;
 if(['state_mismatch','state_security_mismatch','invalid_code','invalid_grant','invalid','invalid_callback_request','no_code','nonce_binding_missing','issuer_mismatch'].includes(code??''))return 'invalid';
 return 'unavailable';
}
