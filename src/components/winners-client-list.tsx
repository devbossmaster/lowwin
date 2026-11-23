'use client';
import {useEffect} from 'react';
import {WinnerCards} from './winner-cards';
import {MiniPhrase} from './mini-locale';
import {useMiniPage} from './mini-query-state';
import {usePublicQuery} from './public-query';
import {PrivateState,usePrivateQuery} from './private-query';
import type {listCompletedWinners} from '@/modules/auctions/results';
import {winnersQueryUrl,recentWinnersQueryUrl} from '@/lib/catalog-query';
import {maskPhoneDisplay} from '@/lib/phone-mask';
import {MiniRouteSkeleton} from './mini-route-skeleton';
import {miniQueryPolicy} from './mini-query-policy';
import {readPublicQuery,seedPublicQuery} from './public-query-cache';

export type WinnersData=Awaited<ReturnType<typeof listCompletedWinners>>&{allowDemo:boolean};
export function WinnersListLoading(){return <MiniRouteSkeleton variant="winners" compact/>}
export function WinnersClientList({initial,carousel=false}:{initial?:WinnersData;carousel?:boolean}={}){
 const [savedPage,setPage]=useMiniPage(),page=carousel?1:savedPage,winnersUrl=winnersQueryUrl(page),url=carousel?recentWinnersQueryUrl():winnersUrl,policy=miniQueryPolicy(url),seed=initial?.page===page?initial:undefined;
 // Published results are historical display data. Home keeps its cards visible
 // and checks quietly on that existing policy, without recurring loading feedback.
 const publicQuery=usePublicQuery<WinnersData>(recentWinnersQueryUrl(),{enabled:carousel,keepPreviousData:true,initialData:carousel?seed:undefined,pollMs:carousel?policy.staleMs:0,freshnessMs:policy.staleMs});
 // Signed-in Home visitors reuse the private page-one winners cache. The
 // public cards render while this optional identity lookup is in flight.
 const privateQuery=usePrivateQuery<WinnersData>(winnersUrl,{
  enabled:!carousel||!!publicQuery.data?.items.length,keepPreviousData:!carousel,
  initialData:!carousel?seed:undefined,pollMs:policy.staleMs,
 });
 const query=carousel?publicQuery:privateQuery,data=query.data,busy=query.isPlaceholderData;
 const authenticatedWinners=carousel&&privateQuery.status==='authenticated'&&privateQuery.data?.page===1?privateQuery.data.items:[];
 const items=carousel?data?.items.slice(0,6).map(item=>{
  const result=item.result,identity=authenticatedWinners.find(winner=>winner.code===item.code)?.result;
  if(result?.source!=='SETTLED'||result.outcome!=='WINNER'||identity?.source!=='SETTLED'||identity.outcome!=='WINNER'||identity.publishedAt!==result.publishedAt)return item;
  const phone=identity.winnerPhoneMasked;
  return {...item,result:{...result,winnerDisplay:identity.winnerDisplay,winnerPhoneMasked:phone?.includes('*')?maskPhoneDisplay(phone):null}};
 }):data?.items;
 useEffect(()=>{
  if(!carousel||!seed)return;const saved=readPublicQuery<WinnersData>(url);
  if(!saved||Date.parse(seed.serverNow)>Date.parse(saved.value.serverNow))seedPublicQuery(url,seed);
 },[seed,url,carousel]);
 return <div data-winners-ready={!!data&&!busy||undefined} data-winners-refreshing={query.fetching||undefined}>
  {(data||query.error||!['loading','authenticated'].includes(query.status))&&(!carousel||!data||!!query.error)&&<PrivateState query={query}/>}
  {!data&&!query.error&&['loading','authenticated'].includes(query.status)&&<WinnersListLoading/>}
  {query.status==='authenticated'&&data&&items&&<><WinnerCards items={items} carousel={carousel} allowDemo={data.allowDemo}/>{!carousel&&data.totalPages>1&&<nav className="pagination" aria-label="Winner pages"><button disabled={busy||data.page<=1} onClick={()=>setPage(data.page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{data.page} / {data.totalPages}</span><button disabled={busy||data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>}</>}
 </div>;
}
