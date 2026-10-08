import {catalogQuerySchema,type CatalogQuery} from './catalog';

type SearchParams=Record<string,string|string[]|undefined>;
export function parseBrowseQuery(values:SearchParams):CatalogQuery{
  const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
  const q=first(values.q)??first(values.search),status=first(values.status),category=first(values.category),sort=first(values.sort),rawPage=first(values.page);
  const page=rawPage&&/^\d{1,4}$/.test(rawPage)?Number(rawPage):1;
  return catalogQuerySchema.parse({
    q:q&&q.length<=80?q:'',
    status:status&&['all','live','upcoming','closing','closed'].includes(status)?status:'all',
    category:category&&/^[a-z0-9-]{1,80}$/.test(category)?category:undefined,
    sort:sort&&['code','ending','newest','title'].includes(sort)?sort:'code',
    page:page>=1&&page<=1000?page:1,
  });
}

export function auctionBrowseHref(query:CatalogQuery,changes:Partial<CatalogQuery>={}):string{
  const next={...query,...changes};
  const params=new URLSearchParams();
  if(next.q)params.set('q',next.q);
  if(next.status!=='all')params.set('status',next.status);
  if(next.category)params.set('category',next.category);
  if(next.sort!=='code')params.set('sort',next.sort);
  if(next.page>1)params.set('page',String(next.page));
  const suffix=params.toString();
  return `/auctions/all${suffix?`?${suffix}`:''}`;
}
