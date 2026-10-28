import {chapaUuid} from './chapa-client';

/** A return link identifies an attempt, never a payer, amount or payment result. */
export function chapaReturnPath(id:string|null|undefined):string|null{
 return id?.length===36&&chapaUuid.test(id)?`/payments/chapa/return?checkout=${id.toLowerCase()}`:null;
}

export function chapaReturnStartPath(payload:string|null|undefined):string|null{
 return payload?.startsWith('chapa_')?chapaReturnPath(payload.slice(6)):null;
}

/** Use only an owned server response to choose the original payment surface. */
export function chapaOriginPath(order:{id:string;purpose:string;auctionSlug:string|null}):string|null{
 if(!chapaReturnPath(order.id))return null;
 const id=order.id.toLowerCase();
 if(order.purpose==='TOP_UP')return `/profile?topup=1&chapa=${id}#wallet`;
 return order.purpose==='BID'&&order.auctionSlug&&/^[a-z0-9-]{1,120}$/.test(order.auctionSlug)?`/auctions/${order.auctionSlug}?chapa=${id}#bid-review`:null;
}

export function chapaBotReturnLink(botUrl:string|null|undefined,id:string|null|undefined):string|null{
 if(!botUrl||!chapaReturnPath(id)||/[\u0000-\u0020\\]/.test(botUrl))return null;
 try{
  const url=new URL(botUrl);
  if(url.protocol!=='https:'||url.hostname!=='t.me'||url.port||url.username||url.password||url.hash||!/^\/[A-Za-z0-9_]+bot$/i.test(url.pathname)||[...url.searchParams.keys()].some(key=>key!=='start')||url.searchParams.getAll('start').length>1)return null;
  url.searchParams.set('start',`chapa_${id!.toLowerCase()}`);
  return url.href;
 }catch{return null}
}
