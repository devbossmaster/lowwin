import {catalogQuerySchema,type CatalogQuery} from './catalog';
export {auctionBrowseHref} from './browse-links';

type SearchParams=Record<string,string|string[]|undefined>;
export function parseBrowseQuery(values:SearchParams):CatalogQuery{
  const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
  const q=first(values.q)??first(values.search),status=first(values.status),category=first(values.category),sort=first(values.sort),rawPage=first(values.page);
  const page=rawPage&&/^\d{1,4}$/.test(rawPage)?Number(rawPage):1;
  return catalogQuerySchema.parse({
    q:q&&q.length<=80?q:'',
    status:status&&['all','live','upcoming','closing','closed'].includes(status)?status:'all',
    category:category&&/^[a-z0-9-]{1,80}$/.test(category)?category:undefined,
    sort:sort&&['code','ending','newest','title','fee-low','fee-high'].includes(sort)?sort:'newest',
    page:page>=1&&page<=1000?page:1,
  });
}
