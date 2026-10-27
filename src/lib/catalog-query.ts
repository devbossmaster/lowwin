import type {CatalogQuery} from '@/modules/auctions/catalog';
/** Matching Home/browse filters share the same ten-row resource and projection. */
export function catalogBatchUrl(query:CatalogQuery,page=query.page){
 return '/api/catalog/auctions?'+new URLSearchParams({view:query.status==='live'?'home':'browse',status:query.status,sort:query.sort,page:String(page),...(query.category?{category:query.category}:{}),...(query.q?{q:query.q}:{})});
}
export function winnersQueryUrl(page=1){return `/api/results/winners?page=${page}`}
