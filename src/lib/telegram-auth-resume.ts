import {miniReturnPath} from './mini-return';

export const TELEGRAM_AUTH_RESUME_TTL_MS=15*60_000;
const storageKey='lowwin:telegram-auth-resume:v1';
type ResumeStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type PaymentMethod='wallet'|'telebirr'|'cbebirr'|'mpesa'|null;
export type TelegramBidResumeDraft={kind:'bid';auctionSlug:string;auctionCode:string;numbers:string[];input:string;multiple:boolean;numberMode:'individual'|'range';rangeFrom:string;rangeTo:string;rangeStep:string|null;method:PaymentMethod;applyCoupon:boolean};
export type TelegramTopupResumeDraft={kind:'topup';amount:string;method:Exclude<PaymentMethod,'wallet'>;stage:'amount'|'bonus'|'payment'};
export type TelegramResumeDraft=TelegramBidResumeDraft|TelegramTopupResumeDraft;
export type TelegramAuthResume={version:1;createdAt:number;destination:string;owner:string|null;scrollY:number;draft:TelegramResumeDraft|null};
const identifiers=/^[A-Za-z0-9-]{1,120}$/,decimal=/^\d{0,16}(?:\.\d{0,2})?$/;
const queryFields=new Set(['category','status','sort','page','view','tab','type','q','topup','mode']);
const anchors=new Set(['#bid-review','#wallet','#results','#auction-terms','#recent-winners','#how-it-works']);
function browserStorage(){try{return typeof window==='undefined'?null:window.sessionStorage}catch{return null}}
function ownerId(value:unknown):value is string|null{return value===null||typeof value==='string'&&value.length>0&&value.length<=128&&!/[\s\u0000-\u001f\u007f]/.test(value)}
function numberInput(value:unknown):value is string{return typeof value==='string'&&decimal.test(value)}
function method(value:unknown):value is PaymentMethod{return value===null||['wallet','telebirr','cbebirr','mpesa'].includes(value as string)}
/** Only ordinary screen coordinates are stored. OAuth/payment references and
 * arbitrary URL fields are never copied into browser storage. */
export function telegramAuthResumeDestination(value:string){
 const url=new URL(miniReturnPath(value),'https://lowwin.invalid');
 const query=new URLSearchParams();
 for(const [key,item] of url.searchParams)if(queryFields.has(key)&&item.length<=120&&!/[\u0000-\u001f\u007f]/.test(item)&&!query.has(key))query.set(key,item);
 return url.pathname+(query.size?'?'+query.toString():'')+(anchors.has(url.hash)?url.hash:'');
}
/** Explicit projection: never persist a phone, session, quote, intent key,
 * authorization code, OTP or payment outcome supplied by a caller. */
export function projectTelegramResumeDraft(value:unknown):TelegramResumeDraft|null{
 if(!value||typeof value!=='object')return null;
 const item=value as Record<string,unknown>;
 if(item.kind==='bid'&&typeof item.auctionSlug==='string'&&identifiers.test(item.auctionSlug)&&typeof item.auctionCode==='string'&&identifiers.test(item.auctionCode)&&Array.isArray(item.numbers)&&item.numbers.length<=50&&item.numbers.every(numberInput)&&numberInput(item.input)&&typeof item.multiple==='boolean'&&['individual','range'].includes(item.numberMode as string)&&numberInput(item.rangeFrom)&&numberInput(item.rangeTo)&&(item.rangeStep===null||numberInput(item.rangeStep))&&method(item.method)&&typeof item.applyCoupon==='boolean')return {kind:'bid',auctionSlug:item.auctionSlug,auctionCode:item.auctionCode,numbers:[...item.numbers] as string[],input:item.input,multiple:item.multiple,numberMode:item.numberMode as 'individual'|'range',rangeFrom:item.rangeFrom,rangeTo:item.rangeTo,rangeStep:item.rangeStep as string|null,method:item.method,applyCoupon:item.applyCoupon};
 if(item.kind==='topup'&&numberInput(item.amount)&&method(item.method)&&item.method!=='wallet'&&['amount','bonus','payment'].includes(item.stage as string))return {kind:'topup',amount:item.amount,method:item.method,stage:item.stage as TelegramTopupResumeDraft['stage']};
 return null;
}
const activeDrafts=new Map<symbol,{owner:string|null;read:()=>TelegramResumeDraft|null}>();
/** Mounted editable forms register a getter; writing happens only when the
 * customer explicitly leaves for sign-in, never on every keystroke. */
export function registerTelegramResumeDraft(owner:string|null,read:()=>TelegramResumeDraft|null){
 const key=Symbol();activeDrafts.set(key,{owner,read});return()=>{activeDrafts.delete(key)};
}
export function rememberTelegramAuthResume(destination:string,owner:string|null,options:{storage?:ResumeStorage|null;now?:number;scrollY?:number}={}){
 const storage=options.storage===undefined?browserStorage():options.storage;if(!storage||!ownerId(owner))return null;
 const active=[...activeDrafts.values()].reverse().find(entry=>entry.owner===owner);
 const previous=active?null:readTelegramAuthResume(owner,{storage,now:options.now});
 const preserved=previous?.owner===owner&&previous.destination===telegramAuthResumeDestination(destination)?previous:null;
 const draft=active?projectTelegramResumeDraft(active.read()):preserved?.draft??null;
 const next=draft?.kind==='bid'?`/auctions/${draft.auctionCode}#bid-review`:draft?.kind==='topup'?'/profile?topup=1':destination;
 const result:TelegramAuthResume={version:1,createdAt:preserved?.createdAt??options.now??Date.now(),destination:telegramAuthResumeDestination(next),owner,scrollY:preserved?.scrollY??Math.max(0,Math.min(100_000,options.scrollY??0)),draft};
 try{storage.setItem(storageKey,JSON.stringify(result));return result}catch{return null}
}
export function readTelegramAuthResume(owner:string|null,options:{storage?:ResumeStorage|null;now?:number}={}){
 const storage=options.storage===undefined?browserStorage():options.storage;if(!storage||!ownerId(owner))return null;
 try{
  const raw=storage.getItem(storageKey);if(!raw)return null;
  const item=JSON.parse(raw) as Partial<TelegramAuthResume>,now=options.now??Date.now();
  if(item.version!==1||!Number.isFinite(item.createdAt)||item.createdAt!>now||now-item.createdAt!>=TELEGRAM_AUTH_RESUME_TTL_MS||!ownerId(item.owner)||item.owner!==null&&item.owner!==owner||typeof item.destination!=='string'||!Number.isFinite(item.scrollY)){
   storage.removeItem(storageKey);return null;
  }
  return {version:1 as const,createdAt:item.createdAt!,destination:telegramAuthResumeDestination(item.destination),owner:item.owner,scrollY:Math.max(0,Math.min(100_000,item.scrollY!)),draft:projectTelegramResumeDraft(item.draft)};
 }catch{try{storage.removeItem(storageKey)}catch{}return null}
}
/** Call only after the server has restored identity. Restoring editable inputs
 * neither reuses an approved quote nor invokes any payment command. */
export function consumeTelegramResumeDraft(owner:string,kind:'bid',auctionSlug:string,options?:{storage?:ResumeStorage|null;now?:number}):TelegramBidResumeDraft|null;
export function consumeTelegramResumeDraft(owner:string,kind:'topup',auctionSlug?:undefined,options?:{storage?:ResumeStorage|null;now?:number}):TelegramTopupResumeDraft|null;
export function consumeTelegramResumeDraft(owner:string,kind:'bid'|'topup',auctionSlug?:string,options:{storage?:ResumeStorage|null;now?:number}={}){
 const record=readTelegramAuthResume(owner,options),draft=record?.draft;
 if(!draft||draft.kind!==kind||draft.kind==='bid'&&draft.auctionSlug!==auctionSlug)return null;
 const storage=options.storage===undefined?browserStorage():options.storage;
 try{storage?.removeItem(storageKey)}catch{}
 return draft;
}
export function clearTelegramAuthResume(storage:ResumeStorage|null=browserStorage()){try{storage?.removeItem(storageKey)}catch{}}
