/** Public navigation only. A launch parameter never authorizes a bid or payment. */
export function auctionStartPath(payload:string|null|undefined){
 const match=/^auction_([1-9]\d{0,9})$/.exec(payload??'');
 return match&&Number(match[1])<=2147483647?`/auctions/${match[1]}`:null;
}
export function auctionMiniAppLink(botUrl:string|null|undefined,code:string){
 if(!auctionStartPath('auction_'+code)||!botUrl)return null;
 try{
  const url=new URL(botUrl);
  if(url.protocol!=='https:'||url.hostname!=='t.me'||url.port||url.username||url.password||url.hash||!/^\/[A-Za-z0-9_]+bot$/i.test(url.pathname)||[...url.searchParams.keys()].some(key=>key!=='start'))return null;
  url.search='';url.searchParams.set('startapp','auction_'+code);return url.href;
 }catch{return null}
}
export function auctionShareLinks({botUrl,code,title,origin}:{botUrl:string|null;code:string;title:string;origin:string}){
 if(!/^[A-Za-z0-9-]{1,120}$/.test(code)||code==='all')throw Error('Invalid auction');
 const website=new URL('/auctions/'+encodeURIComponent(code),origin).href;
 const launch=auctionMiniAppLink(botUrl,code)??website;
 const text=title+' · LowWin';
 return {website,launch,telegram:'https://t.me/share/url?'+new URLSearchParams({url:launch,text}),whatsapp:'https://wa.me/?'+new URLSearchParams({text:text+'\n'+website}),facebook:'https://www.facebook.com/sharer/sharer.php?'+new URLSearchParams({u:website}),x:'https://twitter.com/intent/tweet?'+new URLSearchParams({url:website,text})};
}
