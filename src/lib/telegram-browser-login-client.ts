import {miniReturnPath} from './mini-return';

export const TELEGRAM_BROWSER_LOGIN_ERRORS=['cancelled','expired','unavailable','invalid','contact_required','conflict'] as const;
export type TelegramBrowserLoginError=typeof TELEGRAM_BROWSER_LOGIN_ERRORS[number];
export type TelegramEnvironment='detecting'|'mini'|'browser';

/** Presentation only. Server authentication never trusts SDK globals or URL hints. */
export function telegramEnvironment(app:{initData?:string}|undefined):Exclude<TelegramEnvironment,'detecting'>{
 return app?.initData?'mini':'browser';
}
export function telegramBrowserLoginError(value:string|null):TelegramBrowserLoginError|null{
 return TELEGRAM_BROWSER_LOGIN_ERRORS.includes(value as TelegramBrowserLoginError)?value as TelegramBrowserLoginError:null;
}
export function telegramBrowserLoginDestination(location:{pathname:string;search:string;hash:string}):string{
 const query=new URLSearchParams(location.search),next=query.get('next');
 query.delete('telegramLoginError');
 if(next!==null)return miniReturnPath(next);
 const search=query.toString();
 return miniReturnPath(location.pathname+(search?'?'+search:'')+location.hash);
}
export function telegramBrowserLoginStart(next:string,language:'en'|'am'):string{
 const query=new URLSearchParams({next:miniReturnPath(next),lang:language});
 return '/api/auth/telegram/browser/start?'+query.toString();
}
