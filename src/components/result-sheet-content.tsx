'use client';
import {useEffect,useRef,useState,type CSSProperties,type RefObject} from 'react';
import {ChevronRight,Phone,Trophy} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {PrivateState,usePrivateQuery} from './private-query';
import {miniNavigationState} from './mini-navigation-state';
import {useTelegram} from './telegram-provider';
import {formatAuctionBid,formatEtb} from '@/lib/money';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {maskPhoneDisplay} from '@/lib/phone-mask';
import type {ResultBreakdown} from '@/modules/auctions/result-breakdown';
import {ResultRowsSkeleton} from './mini-route-skeleton';
import styles from './winner-results.module.css';

function Pager({page,totalPages,change,disabled=false}:{page:number;totalPages:number;change:(value:number)=>void;disabled?:boolean}){
 const {language}=useMiniLocale();
 return totalPages>1?<nav className={styles.pager} aria-label={language==='am'?'የውጤት ገጾች':'Result pages'}><button disabled={disabled||page<=1} onClick={()=>change(page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{page} / {totalPages}</span><button disabled={disabled||page>=totalPages} onClick={()=>change(page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>:null;
}
function ParticipantSheet({code,amount,displayAmount,onClose,returnFocusRef}:{code:string;amount:string;displayAmount:string;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>}){
 const {queryIdentity}=useTelegram(),{language}=useMiniLocale(),am=language==='am',pageKey='result:'+code+':'+amount,[page,setPage]=useState(()=>miniNavigationState.page(queryIdentity,pageKey));
 useEffect(()=>miniNavigationState.rememberPage(queryIdentity,pageKey,page),[queryIdentity,pageKey,page]);
 const query=usePrivateQuery<ResultBreakdown>('/api/results/'+encodeURIComponent(code)+'/breakdown?amount='+encodeURIComponent(amount)+'&page='+page,{keepPreviousData:true,cancelOnUnmount:true}),data=query.data?.kind==='participants'?query.data:null;
 const first=data?(data.page-1)*data.pageSize+1:1;
 return <AccountSheet title={<><span className="sr-only"><MiniPhrase en="Bid details" am="የጨረታ ዝርዝር"/></span><span className={styles.participantNumber} aria-hidden="true">{displayAmount}</span></>} presentation="centered" onClose={onClose} returnFocusRef={returnFocusRef}>
  {!data&&query.status==='authenticated'&&!query.error?<ResultRowsSkeleton participants/>:<PrivateState query={query}/>}
  {data&&<>
   <div className={styles.participantFacts}>
    <span><strong>{data.bidCount}</strong> <MiniPhrase en="Bids" am="ጨረታዎች"/></span>
    <span><strong>{data.playerCount}</strong> <MiniPhrase en="Players" am="ተጫራቾች"/></span>
    {data.winner?<span data-winning><Trophy size={12} aria-hidden="true"/><MiniPhrase en="Winning entry" am="ያሸነፈው ጨረታ"/></span>:
      <span>{data.unique?<MiniPhrase en="Picked once" am="አንድ ጊዜ የተመረጠ"/>:<MiniPhrase en="Repeated" am="የተደገመ"/>}</span>}
   </div>
   <ol className={styles.people} start={first} role="list" aria-busy={query.fetching} aria-label={am?`የጨረታ ቁጥር ${displayAmount}`:`Bids for ${displayAmount}`}>
    {data.participants.map((person,index)=><li key={first+index}>
     <span className={styles.rowNumber} aria-hidden="true">#{first+index}</span>
     <span className={styles.rowPhone}><Phone size={12} aria-hidden="true"/><span dir="ltr">{maskPhoneDisplay(person.phoneMasked)??<MiniPhrase en="Unavailable" am="አልተገኘም"/>}</span></span>
     <time dateTime={person.submittedAt}>{formatAddisTimestamp(person.submittedAt,am?'am-ET':'en-GB')}</time>
    </li>)}
   </ol>
   <Pager page={data.page} totalPages={data.totalPages} change={setPage} disabled={query.isPlaceholderData}/>
  </>}
 </AccountSheet>;
}
export default function ResultBreakdownContent({code}:{code:string}){
 const {queryIdentity}=useTelegram(),{language}=useMiniLocale(),am=language==='am',[view,setView]=useState(()=>miniNavigationState.result(queryIdentity,code)),{page,sort,jump}=view,[amount,setAmount]=useState<string|null>(null),amountTrigger=useRef<HTMLElement|null>(null),winningRow=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>miniNavigationState.rememberResult(queryIdentity,code,view),[queryIdentity,code,view]);
 const query=usePrivateQuery<ResultBreakdown>('/api/results/'+encodeURIComponent(code)+'/breakdown?page='+page+'&sort='+sort+(jump?'&jump=winner':''),{keepPreviousData:true,cancelOnUnmount:true}),data=query.data?.kind==='amounts'?query.data:null,busy=query.isPlaceholderData;
 useEffect(()=>{if(jump&&data&&!busy)winningRow.current?.scrollIntoView({block:'nearest',behavior:'instant'})},[jump,data,busy]);
 const largest=data?Math.max(1,...data.amounts.map(row=>row.bidCount)):1;
 return <>
  {!data&&query.status==='authenticated'&&!query.error?<ResultRowsSkeleton/>:<PrivateState query={query}/>}
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
 {amount!==null&&data&&<ParticipantSheet key={code+':'+amount} code={code} amount={amount} displayAmount={formatAuctionBid(amount,data.auction.terms.ruleVersion)} onClose={()=>setAmount(null)} returnFocusRef={amountTrigger}/>}
 </>;
}
