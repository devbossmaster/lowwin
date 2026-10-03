import type {Bank} from './provider';

export class PaymentError extends Error{constructor(public status:number,message:string){super(message)}}

export function canonical(bank:Bank,raw:string){
 const value=raw.trim();
 if(bank==='telebirr'){const upper=value.toUpperCase();if(!/^[A-Z][A-Z0-9]{7,31}$/.test(upper))throw new PaymentError(422,'Enter a supported transaction number.');return upper}
 if(/^FT[A-Z0-9]{6,30}$/i.test(value))return value.toUpperCase();
 if(/^FT/i.test(value)||!/^[A-Za-z0-9_-]{12,128}$/.test(value))throw new PaymentError(422,'Enter a CBE Receipt ID or legacy FT reference.');
 return value;
}

// Parse known receipt shapes locally. A URL is never fetched by Lowwin.
export function candidate(bank:Bank,raw:string){
 const text=raw.trim();if(!text||text.length>4000)throw new PaymentError(422,'Enter one transaction reference or receipt.');
 // SMS apps commonly place a period or closing bracket immediately after the
 // official receipt URL. Those characters are prose, not part of the receipt.
 const urls=[...new Set((text.match(/https?:\/\/[^\s<>"']+/g)??[]).map(value=>value.replace(/[\])}>.,;:!?]+$/g,'')))];
 if(urls.length){
  if(urls.length!==1)throw new PaymentError(422,'More than one receipt was found. Enter one reference.');
  const url=new URL(urls[0]);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.search)throw new PaymentError(422,'Use an official supported receipt link or enter the reference.');
  if(bank==='cbe'&&url.hostname==='mbreciept.cbe.com.et'&&/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(url.pathname))return canonical(bank,url.pathname.split('/').filter(Boolean).at(-1)!);
  if(bank==='telebirr'&&['apps.ethiotelecom.et','transactioninfo.ethiotelecom.et'].includes(url.hostname)&&/^\/receipt\/[A-Za-z0-9]{8,32}\/?$/.test(url.pathname))return canonical(bank,url.pathname.split('/')[2]);
  throw new PaymentError(422,'Use an official supported receipt link or enter the reference.');
 }
 if(/^[A-Za-z0-9_-]+$/.test(text))return canonical(bank,text);
 if(bank==='cbe'&&/telebirr/i.test(text)||bank==='telebirr'&&/\bCBE\b|Commercial Bank/i.test(text))throw new PaymentError(422,'Receipt bank does not match the selected account.');
 const separator='\\s*(?:is\\s*)?[:#-]?\\s*';
 const label=bank==='cbe'?'(?:receipt\\s*(?:id|number|no\\.?)|reference(?:\\s*(?:number|id|no\\.?))?)':'(?:transaction\\s*(?:number|id|no\\.?|reference)?|reference|receipt(?:\\s*(?:number|id|no\\.?))?)';
 const pattern=new RegExp(`${label}${separator}([A-Za-z][A-Za-z0-9_-]{7,127})(?![A-Za-z0-9_-])`,'gi');
 const found=[...text.matchAll(pattern)].map(match=>canonical(bank,match[1]));
 const unique=[...new Set(found)];if(unique.length!==1)throw new PaymentError(422,'A single clear reference could not be found. Enter it manually.');return unique[0];
}
