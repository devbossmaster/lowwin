import {chapaReturnPath} from './chapa-return-link';

/** Only customer destinations may survive the Telegram authentication handoff. */
export function miniReturnPath(value:string|null|undefined):string{
 if(!value||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(value))return '/';
 try{
  const url=new URL(value,'https://lowin.invalid');
  if(url.origin!=='https://lowin.invalid')return '/';
  if(url.pathname==='/payments/chapa/return'){
   if(url.hash||url.searchParams.getAll('checkout').length!==1||[...url.searchParams.keys()].some(key=>key!=='checkout'))return '/';
   return chapaReturnPath(url.searchParams.get('checkout'))??'/';
  }
  const customer=/^\/(?:auctions(?:\/[A-Za-z0-9-]{1,120})?|categories\/[a-z0-9-]{1,80}|draws|my-bids|winning-bids|wallet(?:\/deposit)?|payments|profile(?:\/(?:favorites|alerts|wins|support))?|winners(?:\/[A-Za-z0-9-]{1,120})?|faq|terms|privacy)?$/;
  return customer.test(url.pathname)?url.pathname+url.search+url.hash:'/';
 }catch{return '/'}
}
