'use client';
import {WinnerCards} from './winner-cards';
import {MiniPhrase} from './mini-locale';
import {useMiniPage} from './mini-query-state';
import {usePrivateQuery,PrivateState} from './private-query';
import type {listCompletedWinners} from '@/modules/auctions/results';
import {winnersQueryUrl} from '@/lib/catalog-query';
import {MiniRouteSkeleton} from './mini-route-skeleton';

export type WinnersData=Awaited<ReturnType<typeof listCompletedWinners>>&{allowDemo:boolean};
export function WinnersListLoading(){return <MiniRouteSkeleton variant="winners" compact/>}
export function WinnersClientList({initial,carousel=false}:{initial?:WinnersData;carousel?:boolean}={}){
 const [savedPage,setPage]=useMiniPage(),page=carousel?1:savedPage,query=usePrivateQuery<WinnersData>(winnersQueryUrl(page),{keepPreviousData:true,initialData:initial}),data=query.data,busy=query.isPlaceholderData;
 return <div data-winners-ready={!!data&&!busy||undefined}>
  {(data||query.error||!['loading','authenticated'].includes(query.status))&&<PrivateState query={query}/>}
  {!data&&!query.error&&['loading','authenticated'].includes(query.status)&&<WinnersListLoading/>}
  {query.status==='authenticated'&&data&&<><WinnerCards items={carousel?data.items.slice(0,6):data.items} carousel={carousel} allowDemo={data.allowDemo}/>{!carousel&&data.totalPages>1&&<nav className="pagination" aria-label="Winner pages"><button disabled={busy||data.page<=1} onClick={()=>setPage(data.page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{data.page} / {data.totalPages}</span><button disabled={busy||data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>}</>}
 </div>;
}
