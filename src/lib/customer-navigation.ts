export const CUSTOMER_HISTORY_MARK='lowwinCustomerPage';
type PageMark={version:1;identity:string;href:string;previous:boolean};
export function customerPageTitle(path:string):readonly [string,string]{
 if(path==='/winners'||path==='/winners/all'||path==='/draws')return ['Winners','አሸናፊዎች'];
 if(path.startsWith('/winners/'))return ['Auction result','የጨረታ ውጤት'];
 if(path==='/my-bids')return ['My Bids','የእኔ ጨረታዎች'];
 if(path==='/profile')return ['Profile','መገለጫ'];
 if(path==='/wallet/deposit')return ['Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ'];
 if(path.startsWith('/wallet'))return ['Wallet','ዋሌት'];
 if(path==='/payments')return ['Bid payments','የጨረታ ክፍያዎች'];
 if(path==='/auctions'||path==='/auctions/all'||path.startsWith('/categories/'))return ['Auctions','ጨረታዎች'];
 if(path.startsWith('/auctions/'))return ['Auction details','የጨረታ ዝርዝር'];
 if(path==='/terms')return ['Terms & conditions','ውሎች እና ሁኔታዎች'];
 if(path==='/privacy')return ['Privacy policy','የግላዊነት ፖሊሲ'];
 if(path==='/winning-bids'||path==='/profile/wins')return ['My wins','ያሸነፍኳቸው ጨረታዎች'];
 if(path==='/profile/alerts')return ['Notifications','ማሳወቂያዎች'];
 if(path==='/profile/favorites')return ['Favorites','ተወዳጆች'];
 if(path==='/profile/support')return ['Support','ድጋፍ'];
 if(path==='/faq')return ['How it works','እንዴት እንደሚሠራ'];
 return ['Account','መለያ'];
}
function mark(state:unknown):PageMark|null{
 if(!state||typeof state!=='object')return null;
 const value=(state as Record<string,unknown>)[CUSTOMER_HISTORY_MARK] as Partial<PageMark>|undefined;
 return value?.version===1&&typeof value.identity==='string'&&typeof value.href==='string'&&typeof value.previous==='boolean'?value as PageMark:null;
}
export function canGoBackInCustomerApp(state:unknown,identity:string|null){return !!identity&&mark(state)?.identity===identity&&mark(state)?.previous===true}
/** Browser history metadata only; it contains no private response or session token. */
export class CustomerNavigationHistory{
 private identity:string|null=null;
 private href:string|null=null;
 enter(identity:string,href:string,state:unknown,popped=false):PageMark{
  if(identity!==this.identity){this.identity=identity;this.href=null}
  const saved=mark(state),existing=saved?.identity===identity&&saved.href===href?saved:null;
  const next:PageMark=existing&&(popped||this.href===null||this.href===href)?existing:{version:1,identity,href,previous:this.href!==null&&this.href!==href};
  this.href=href;return next;
 }
 reset(){this.identity=null;this.href=null}
}
