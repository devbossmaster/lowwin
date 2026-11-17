import {chapaUuid} from './chapa-client';

type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type ChapaRecoveryPointer={version:1;key:string;orderId?:string;protocol?:'inline'|'direct'};
const prefix='lowwin:chapa-recovery:v1:';
const account=(value:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(value);
const scope=(value:string)=>value==='topup'||/^bid:[a-z0-9-]{1,120}$/.test(value);
const storageKey=(owner:string,resource:string)=>account(owner)&&scope(resource)?`${prefix}${owner}:${resource}`:null;

export function chapaRecoveryStorage():Storage|null{try{return typeof window==='undefined'?null:window.sessionStorage}catch{return null}}
/** Opaque navigation recovery only. No amounts, phones, quotes, tokens, cookies
 * or payment evidence enter browser storage; every restored pointer is checked
 * through the authenticated owned endpoint before any result is displayed. */
export function readChapaRecoveryPointer(storage:Storage|null,owner:string,resource:string):ChapaRecoveryPointer|null{
 try{
  const name=storageKey(owner,resource);if(!storage||!name)return null;
  const raw=storage.getItem(name);if(!raw||raw.length>256)return null;
  const value=JSON.parse(raw) as ChapaRecoveryPointer;
  return value?.version===1&&typeof value.key==='string'&&chapaUuid.test(value.key)&&(value.orderId===undefined||typeof value.orderId==='string'&&chapaUuid.test(value.orderId))&&(value.protocol===undefined||['inline','direct'].includes(value.protocol))&&Object.keys(value).every(key=>['version','key','orderId','protocol'].includes(key))?value:null;
 }catch{return null}
}
/** A second controller in this tab cannot overwrite an unresolved operation. */
export function retainChapaRecoveryPointer(storage:Storage|null,owner:string,resource:string,value:ChapaRecoveryPointer){
 const name=storageKey(owner,resource);if(!storage||!name)return true;
 const previous=readChapaRecoveryPointer(storage,owner,resource);if(previous&&(previous.key!==value.key||(previous.protocol??'inline')!==(value.protocol??'inline')))return false;
 if(!chapaUuid.test(value.key)||value.orderId!==undefined&&!chapaUuid.test(value.orderId))return false;
 try{storage.setItem(name,JSON.stringify({version:1,key:value.key,...(value.protocol?{protocol:value.protocol}:{}),...(value.orderId?{orderId:value.orderId}:previous?.orderId?{orderId:previous.orderId}:{})}))}catch{/* Memory and server ownership still preserve the current operation. */}
 return true;
}
export function clearChapaRecoveryPointer(storage:Storage|null,owner:string,resource:string,expected:{key?:string;orderId?:string}){
 const value=readChapaRecoveryPointer(storage,owner,resource),name=storageKey(owner,resource);
 if(!storage||!name||!value||!expected.key&&!expected.orderId||expected.key&&expected.key!==value.key||expected.orderId&&expected.orderId!==value.orderId)return;
 try{storage.removeItem(name)}catch{}
}
/** Call only after verified account restoration/change or explicit sign-out. */
export function clearChapaRecoveryPointers(storage:Storage|null,keepOwner?:string){
 if(!storage)return;
 try{for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);if(key?.startsWith(prefix)&&(!keepOwner||!account(keepOwner)||!key.startsWith(`${prefix}${keepOwner}:`)))storage.removeItem(key)}}catch{}
}
