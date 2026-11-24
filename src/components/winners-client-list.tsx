'use client';
import {WinnerCards} from './winner-cards';
import {MiniPhrase} from './mini-locale';
import {useMiniPage} from './mini-query-state';
import {usePublicQuery} from './public-query';
import {PrivateState,usePrivateQuery} from './private-query';
import type {listCompletedWinners} from '@/modules/auctions/results';
import {winnersQueryUrl,recentWinnersQueryUrl} from '@/lib/catalog-query';
import {recentWinnerPreview} from '@/lib/catalog-preview';
import {maskPhoneDisplay} from '@/lib/phone-mask';
import {MiniRouteSkeleton} from './mini-route-skeleton';
import {miniQueryPolicy} from './mini-query-policy';

export type WinnersData=Awaited<ReturnType<typeof listCompletedWinners>>&{allowDemo:boolean};
export function WinnersListLoading(){return <MiniRouteSkeleton variant="winners" compact/>}
export function WinnersClientList({initial,carousel=false}:{initial?:WinnersData;carousel?:boolean}={}){
 const [savedPage,setPage]=useMiniPage(),page=carousel?1:savedPage,winnersUrl=winnersQueryUrl(page),seed=initial?.page===page?initial:undefined;
 const privateQuery=usePrivateQuery<WinnersData>(winnersUrl,{
  keepPreviousData:!carousel,
  initialData:!carousel?seed:undefined,pollMs:miniQueryPolicy(winnersUrl).staleMs,
 });
 // Choose one source after session restoration. Rendering a public snapshot
 // before the signed-in result arrives can paint a superseded image.
 const publicPreview=carousel&&['guest','contact-required','error'].includes(privateQuery.status);
 const publicUrl=recentWinnersQueryUrl(),publicPolicy=miniQueryPolicy(publicUrl);
 const publicQuery=usePublicQuery<WinnersData>(publicUrl,{enabled:publicPreview,initialData:publicPreview?seed:undefined,pollMs:publicPolicy.staleMs});
 const query=publicPreview?publicQuery:privateQuery,data=query.data,busy=query.isPlaceholderData;
 const items=carousel?data?.items.slice(0,6).map(item=>{
  if(publicPreview)return item;
  const preview=recentWinnerPreview(item),result=item.result;
  if(preview.result?.source!=='SETTLED'||result?.source!=='SETTLED')return preview;
  const phone=result.winnerPhoneMasked;
  return {...preview,result:{...preview.result,winnerDisplay:result.winnerDisplay,winnerPhoneMasked:phone?.includes('*')?maskPhoneDisplay(phone):null}};
 }):data?.items;
 return <div data-winners-ready={!!data&&!busy||undefined} data-winners-refreshing={query.fetching||undefined}>
  {(data||query.error||!['loading','authenticated'].includes(query.status))&&(!carousel||!data||!!query.error)&&<PrivateState query={query}/>}
  {!data&&!query.error&&['loading','authenticated'].includes(query.status)&&<WinnersListLoading/>}
  {query.status==='authenticated'&&data&&items&&<><WinnerCards items={items} carousel={carousel} allowDemo={data.allowDemo}/>{!carousel&&data.totalPages>1&&<nav className="pagination" aria-label="Winner pages"><button disabled={busy||data.page<=1} onClick={()=>setPage(data.page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{data.page} / {data.totalPages}</span><button disabled={busy||data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>}</>}
 </div>;
}
