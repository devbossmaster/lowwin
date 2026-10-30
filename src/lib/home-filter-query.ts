import type {CatalogQuery} from '@/modules/auctions/catalog';

export function homeAuctionHref(query:CatalogQuery,patch:Partial<CatalogQuery>={}){
 const next={...query,...patch},params=new URLSearchParams();if(next.category)params.set('category',next.category);if(next.sort!=='featured'&&next.sort!=='code')params.set('sort',next.sort);if(next.q)params.set('q',next.q);return '/'+(params.size?'?'+params:'');
}

/** Browser-safe Home URL parsing; never imports the server catalog at runtime. */
export function homeFilterQuery(params:Pick<URLSearchParams,'get'>):CatalogQuery{
 const raw=params.get('q')??params.get('search')??'',category=params.get('category')??'',sort=params.get('sort');
 return {q:raw.length<=80?raw.trim():'',status:'live',page:1,category:/^[a-z0-9-]{1,80}$/.test(category)?category:undefined,
  sort:!sort||sort==='code'?'featured':(['featured','ending','newest','title','fee-low','fee-high'].includes(sort)?sort as CatalogQuery['sort']:'newest')};
}
