'use client';
import {useEffect} from 'react';
import {WinnerCards} from './winner-cards';
import {MiniPhrase} from './mini-locale';
import {useMiniPage} from './mini-query-state';
import {usePublicQuery} from './public-query';
import {PrivateState} from './private-query';
import type {listCompletedWinners} from '@/modules/auctions/results';
import {winnersQueryUrl} from '@/lib/catalog-query';
import {MiniRouteSkeleton} from './mini-route-skeleton';
import {miniQueryPolicy} from './mini-query-policy';
import {readPublicQuery,seedPublicQuery} from './public-query-cache';

export type WinnersData=Awaited<ReturnType<typeof listCompletedWinners>>&{allowDemo:boolean};
export function WinnersListLoading(){return <MiniRouteSkeleton variant="winners" compact/>}
export function WinnersClientList({initial,carousel=false}:{initial?:WinnersData;carousel?:boolean}={}){
 const [savedPage,setPage]=useMiniPage(),page=carousel?1:savedPage,url=winnersQueryUrl(page),policy=miniQueryPolicy(url),seed=initial?.page===page?initial:undefined;
 // Published results are historical display data. Home keeps its cards visible
 // and checks quietly on that existing policy, without recurring loading feedback.
 const query=usePublicQuery<WinnersData>(url,{keepPreviousData:true,initialData:seed,pollMs:carousel?policy.staleMs:30000,freshnessMs:carousel?policy.staleMs:10000}),data=query.data,busy=query.isPlaceholderData;
 useEffect(()=>{
  if(!seed)return;const saved=readPublicQuery<WinnersData>(url);
  if(!saved||Date.parse(seed.serverNow)>Date.parse(saved.value.serverNow))seedPublicQuery(url,seed);
 },[seed,url]);
 return <div data-winners-ready={!!data&&!busy||undefined} data-winners-refreshing={query.fetching||undefined}>
  {(data||query.error||!['loading','authenticated'].includes(query.status))&&(!carousel||!data||!!query.error)&&<PrivateState query={query}/>}
  {!data&&!query.error&&['loading','authenticated'].includes(query.status)&&<WinnersListLoading/>}
  {query.status==='authenticated'&&data&&<><WinnerCards items={carousel?data.items.slice(0,6):data.items} carousel={carousel} allowDemo={data.allowDemo}/>{!carousel&&data.totalPages>1&&<nav className="pagination" aria-label="Winner pages"><button disabled={busy||data.page<=1} onClick={()=>setPage(data.page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{data.page} / {data.totalPages}</span><button disabled={busy||data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>}</>}
 </div>;
}
