/** Stable private resource keys and narrowly affected read models. */
export function adminResourcePath(path:string){
 const url=new URL(path,'https://admin.lowwin.invalid/');
 if(url.origin!=='https://admin.lowwin.invalid'||url.hash)throw Error('Invalid admin resource.');
 url.searchParams.sort();return url.pathname.slice(1)+(url.search?'?'+url.searchParams.toString():'');
}
export const adminResourceMatches=(path:string,scope:string)=>{const base=path.split('?')[0];return base===scope||base.startsWith(scope+'/')};
const affected:Record<string,readonly string[]>={
 category:['categories','products','auctions'],product:['products','auctions','dashboard/auctions'],media:['workspace/media','media'],
 draft:['auctions','dashboard'],publish:['auctions','products','dashboard'],fee:['auctions','dashboard/auctions'],deadline:['auctions','dashboard'],presentation:['auctions','dashboard/auctions'],
 deleteDraft:['auctions','dashboard'],deleteProduct:['products'],removeCancelled:['auctions','dashboard'],replace:['auctions','dashboard'],
 cancel:['auctions','dashboard','workspace/players','users','workspace/transactions','workspace/winners','fulfillment','results'],
 suspend:['workspace/players','users'],deliveryDone:['workspace/winners','fulfillment','dashboard/summary'],fulfillment:['workspace/winners','fulfillment','dashboard/summary'],
 winnerPhoto:['workspace/winners','results'],winnerBanner:['workspace/winners','results'],resultPublish:['workspace/winners','results','auctions','dashboard'],
 broadcast:['notifications'],broadcastStop:['notifications'],retry:['notifications','jobs'],
 'save-policy':['referrals','workspace/referrals'],content:['content'],invite:['team','audit'],staff:['team','audit'],
};
export function adminMutationResources(action:string,endpoint='command'){
 const resource=endpoint.split('?')[0];
 if(['chapa','arifpay'].includes(resource)&&action==='check')return [resource,'workspace/transactions','transactions','workspace/players','users','auctions','dashboard'];
 if(resource==='payments'){
  if(['preview-policy','preview','impact'].includes(action))return [];
  return ['payments','top-ups','workspace/transactions','transactions','workspace/players','users','dashboard/summary'];
 }
 return affected[action]??[];
}
export class AdminPrefetchBudget{
 private recent=new Map<string,number>();private started=0;private count=0;
 constructor(private readonly repeatMs=30000,private readonly maxPerWindow=4,private readonly windowMs=10000){}
 reset(){this.recent.clear();this.started=0;this.count=0}
 allow(identity:string,target:string,now=Date.now()){
  const key=JSON.stringify([identity,target]);if(now-(this.recent.get(key)??-Infinity)<this.repeatMs)return false;
  if(now-this.started>=this.windowMs){this.started=now;this.count=0}if(this.count>=this.maxPerWindow)return false;
  this.recent.delete(key);this.recent.set(key,now);this.count++;while(this.recent.size>24)this.recent.delete(this.recent.keys().next().value!);return true;
 }
}
export function adminRouteResources(href:string){
 const url=new URL(href,'https://admin.lowwin.invalid');if(url.origin!=='https://admin.lowwin.invalid')return [];
 const get=(key:string,fallback='')=>url.searchParams.get(key)??fallback;
 const page=String(Math.max(1,Math.min(100000,Number(get('page','1'))||1)));
 const params=(values:Record<string,string>)=>new URLSearchParams(values).toString();
 switch(url.pathname){
  case '/admin':return ['dashboard/summary','dashboard/auctions'];
  case '/admin/users':return [`workspace/players?${params({page,q:get('q'),status:get('status')})}`];
  case '/admin/fulfillment':return [`workspace/winners?${params({page,q:get('q'),status:get('status')})}`];
  case '/admin/auctions':{
   const raw=get('status'),view=get('view');const status=view==='drafts'?'DRAFT':view==='completed'?'COMPLETED':view==='cancelled'?'CANCELLED':raw||'IN_PROGRESS';
   return [`auctions?${params({status,q:get('q'),category:get('category'),page})}`];
  }
  case '/admin/products':return [`products?${params({q:get('q'),status:get('status'),category:get('category'),page})}`];
  case '/admin/categories':return [`categories?${params({list:'1',q:get('q'),status:get('status'),page})}`];
  // Financial and broadcast queues have their own richer filters/polling.
  // Warm only their route bundle until their exact resource is known.
  default:return [];
 }
}
