'use client';
import {useEffect,useRef,useState,type CSSProperties,type RefObject} from 'react';
import {ChevronRight,Trophy} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {usePublicQuery} from './public-query';
import {PrivateState,usePrivateQuery} from './private-query';
import {publicMiniNavigationState as miniNavigationState} from './mini-navigation-state';
import {formatAuctionBid,formatEtb} from '@/lib/money';
import type {ResultBreakdown} from '@/modules/auctions/result-breakdown';
import styles from './winner-results.module.css';

function Pager({page,totalPages,change,disabled=false}:{page:number;totalPages:number;change:(value:number)=>void;disabled?:boolean}){
 const {language}=useMiniLocale();
 return totalPages>1?<nav className={styles.pager} aria-label={language==='am'?'የውጤት ገጾች':'Result pages'}><button disabled={disabled||page<=1} onClick={()=>change(page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{page} / {totalPages}</span><button disabled={disabled||page>=totalPages} onClick={()=>change(page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>:null;
}
function ParticipantSheet({code,amount,onClose,returnFocusRef}:{code:string;amount:string;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>}){
 const {language}=useMiniLocale(),am=language==='am',pageKey='result:'+code+':'+amount,[page,setPage]=useState(()=>miniNavigationState.page('public',pageKey));
 useEffect(()=>miniNavigationState.rememberPage('public',pageKey,page),[pageKey,page]);
 const query=usePrivateQuery<ResultBreakdown>('/api/results/'+encodeURIComponent(code)+'/breakdown?amount='+encodeURIComponent(amount)+'&page='+page,{keepPreviousData:true,cancelOnUnmount:true}),data=query.data?.kind==='participants'?query.data:null;
 return <AccountSheet title={<MiniPhrase en="Bid details" am="የጨረታ ዝርዝር"/>} onClose={onClose} returnFocusRef={returnFocusRef}>
  {!data&&query.status==='authenticated'&&!query.error?<p className={styles.loading} role="status"><MiniPhrase en="Loading participants…" am="ተሳታፊዎችን በመጫን ላይ…"/></p>:<PrivateState query={query}/>}
  <h3 className={styles.amountTitle}>{data?formatAuctionBid(data.amount,data.auction.terms.ruleVersion):amount}</h3>
  {data&&<>
   <div className={styles.stats}><span><strong>{data.bidCount}</strong><MiniPhrase en="Bids" am="ጨረታዎች"/></span><span><strong>{data.playerCount}</strong><MiniPhrase en="Players" am="ተጫራቾች"/></span><span><strong>{data.unique?<MiniPhrase en="Picked once" am="አንድ ጊዜ የተመረጠ"/>:<MiniPhrase en="Repeated" am="የተደገመ"/>}</strong>{data.winner&&<MiniPhrase en="Winning entry" am="ያሸነፈው ጨረታ"/>}</span></div>
   <h3 className={styles.subheading}><MiniPhrase en="Participants" am="ተሳታፊዎች"/></h3>
   <ul className={styles.people}>{data.participants.map((person,index)=><li key={person.submittedAt+':'+index}>
    <strong>{person.displayName||person.username||<MiniPhrase en="Participant" am="ተሳታፊ"/>}</strong>
    {person.username&&person.displayName&&<span>{person.username}</span>}{person.phoneMasked&&<span>{person.phoneMasked}</span>}
    <time dateTime={person.submittedAt}>{new Date(person.submittedAt).toLocaleString(am?'am-ET':'en-ET',{dateStyle:'medium',timeStyle:'medium',timeZone:'Africa/Addis_Ababa'})}</time>
   </li>)}</ul>
   <Pager page={data.page} totalPages={data.totalPages} change={setPage} disabled={query.isPlaceholderData}/>
  </>}
 </AccountSheet>;
}
export default function ResultBreakdownContent({code}:{code:string}){
 const {language}=useMiniLocale(),am=language==='am',[view,setView]=useState(()=>miniNavigationState.result('public',code)),{page,sort,jump}=view,[amount,setAmount]=useState<string|null>(null),amountTrigger=useRef<HTMLElement|null>(null),winningRow=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>miniNavigationState.rememberResult('public',code,view),[code,view]);
 const query=usePublicQuery<ResultBreakdown>('/api/results/'+encodeURIComponent(code)+'/breakdown?page='+page+'&sort='+sort+(jump?'&jump=winner':''),{keepPreviousData:true,cancelOnUnmount:true}),data=query.data?.kind==='amounts'?query.data:null,busy=query.isPlaceholderData;
 useEffect(()=>{if(jump&&data&&!busy)winningRow.current?.scrollIntoView({block:'nearest',behavior:'instant'})},[jump,data,busy]);
 const largest=data?Math.max(1,...data.amounts.map(row=>row.bidCount)):1;
 return <>
  {!data&&query.status==='authenticated'&&!query.error?<p className={styles.loading} role="status"><MiniPhrase en="Loading bid numbers…" am="የጨረታ ቁጥሮችን በመጫን ላይ…"/></p>:<PrivateState query={query}/>}
  <div data-result-breakdown-ready={!!data&&!busy||undefined}>{data&&<>
   <dl className={styles.resultFacts}><div><dt><MiniPhrase en="Winning entry fee" am="የአሸናፊው ጨረታ ክፍያ"/></dt><dd>{formatEtb(data.entryFee)}</dd></div><div><dt><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></dt><dd>{data.totalBids}</dd></div><div><dt><MiniPhrase en="Auction" am="ጨረታ"/></dt><dd>#{data.auction.code}</dd></div></dl>
   {data.variableFees&&<p className={styles.note}><MiniPhrase en="Fees varied. The fee shown belongs to the winning entry." am="ክፍያዎች ይለያዩ ነበር። የሚታየው የአሸናፊው ጨረታ ክፍያ ነው።"/></p>}
   <h3 className={styles.subheading}><MiniPhrase en="Number breakdown" am="የቁጥሮች ዝርዝር"/></h3>
   <dl className={styles.breakdownTotals}><div><dt><MiniPhrase en="Distinct numbers" am="የተለያዩ ቁጥሮች"/></dt><dd>{data.totalAmounts}</dd></div><div><dt><MiniPhrase en="Picked once" am="አንድ ጊዜ የተመረጡ"/></dt><dd>{data.totalUniqueAmounts}</dd></div><div><dt><MiniPhrase en="Players" am="ተጫራቾች"/></dt><dd>{data.totalPlayers}</dd></div></dl>
   <div className={styles.controls}><div role="group" aria-label={am?'የቁጥሮች ቅደም ተከተል':'Number sorting'}>{(['amount','picked'] as const).map(value=><button key={value} disabled={busy} aria-pressed={data.sort===value} onClick={()=>setView({sort:value,page:1,jump:false})}><MiniPhrase en={value==='amount'?'By number':'Most picked'} am={value==='amount'?'በቁጥር':'በብዛት የተመረጡ'}/></button>)}</div>{data.auction.result?.winningPoints&&<button className={styles.jump} disabled={busy} onClick={()=>{setView(value=>({...value,jump:true}));if(jump)winningRow.current?.scrollIntoView({block:'nearest',behavior:'instant'})}}><Trophy size={13} aria-hidden="true"/><MiniPhrase en="Show winner" am="አሸናፊውን አሳይ"/></button>}</div>
   <ul className={styles.amounts} aria-busy={query.fetching}>{data.amounts.map(row=><li key={row.amount}><button ref={row.winner?winningRow:undefined} disabled={busy} data-result-amount={row.amount} data-winning={row.winner||undefined} style={{'--picked-width':(row.bidCount/largest*100)+'%'} as CSSProperties} onClick={event=>{amountTrigger.current=event.currentTarget;setAmount(row.amount)}}>
    <strong>{formatAuctionBid(row.amount,data.auction.terms.ruleVersion)}</strong>{row.winner&&<Trophy size={13} aria-label={am?'አሸናፊ':'Winner'}/>}<span>{row.bidCount} <MiniPhrase en="bids" am="ጨረታዎች"/></span>{row.unique&&<small><MiniPhrase en="Unique" am="ልዩ"/></small>}<ChevronRight size={16} aria-hidden="true"/>
   </button></li>)}</ul>
   <Pager page={data.page} totalPages={data.totalPages} change={value=>setView(previous=>({...previous,page:value,jump:false}))} disabled={busy}/>
  </>}</div>
  {amount!==null&&<ParticipantSheet key={code+':'+amount} code={code} amount={amount} onClose={()=>setAmount(null)} returnFocusRef={amountTrigger}/>}
 </>;
}
