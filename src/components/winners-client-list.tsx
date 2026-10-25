'use client';
import {WinnerCards} from './winner-cards';
import {MiniPhrase} from './mini-locale';
import {useMiniPage} from './mini-query-state';
import {usePrivateQuery,PrivateState} from './private-query';
import type {listCompletedWinners} from '@/modules/auctions/results';
import styles from './winners-client-list.module.css';

type Data=Awaited<ReturnType<typeof listCompletedWinners>>&{allowDemo:boolean};
export function WinnersListLoading(){return <p className={styles.loading} role="status"><MiniPhrase en="Loading confirmed winners…" am="የተረጋገጡ አሸናፊዎችን በመጫን ላይ…"/></p>}
export function WinnersClientList(){
 const [page,setPage]=useMiniPage(),query=usePrivateQuery<Data>(`/api/results/winners?page=${page}`,{keepPreviousData:true}),data=query.data,busy=query.isPlaceholderData;
 return <div data-winners-ready={!!data&&!busy||undefined}>
  {(data||query.error||!['loading','authenticated'].includes(query.status))&&<PrivateState query={query}/>}
  {!data&&!query.error&&['loading','authenticated'].includes(query.status)&&<WinnersListLoading/>}
  {query.status==='authenticated'&&data&&<><WinnerCards items={data.items} allowDemo={data.allowDemo}/>{data.totalPages>1&&<nav className="pagination" aria-label="Winner pages"><button disabled={busy||data.page<=1} onClick={()=>setPage(data.page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{data.page} / {data.totalPages}</span><button disabled={busy||data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>}</>}
 </div>;
}
