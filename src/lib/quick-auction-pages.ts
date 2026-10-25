import type {listQuickAuctions} from '@/modules/auctions/catalog';
type Batch=Awaited<ReturnType<typeof listQuickAuctions>>;
export function quickAuctionUrl(status:'live'|'upcoming',page=1){return `/api/catalog/auctions?view=quick&status=${status}&page=${page}`}
/** Assemble contiguous cached pages only; a late response cannot enter another tab. */
export function mergeQuickAuctionPages(pages:Batch[],status:'live'|'upcoming'):Batch|null{
 const first=pages.find(page=>page.page===1);if(!first)return null;
 const items:Batch['items']=[],seen=new Set<string>();let last=first;
 for(let next=1;next<=pages.length;next++){
  const page=pages.find(batch=>batch.page===next);if(!page)break;
  last=page;for(const item of page.items)if(item.status===status&&!seen.has(item.code)){seen.add(item.code);items.push(item)}
 }
 return {...last,items};
}
