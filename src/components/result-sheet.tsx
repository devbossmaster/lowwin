'use client';
import {useRef,useState,type RefObject} from 'react';
import {ChevronRight,Trophy} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {CatalogImage} from './catalog-image';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {usePrivateQuery,PrivateState} from './private-query';
import {formatAuctionBid,formatEtb} from '@/lib/money';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import type {ResultBreakdown} from '@/modules/auctions/result-breakdown';
import styles from './winner-results.module.css';

function Pager({page,totalPages,change}:{page:number;totalPages:number;change:(value:number)=>void}){
 return totalPages>1?<nav className={styles.pager} aria-label="Result pages"><button disabled={page<=1} onClick={()=>change(page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button><span>{page} / {totalPages}</span><button disabled={page>=totalPages} onClick={()=>change(page+1)}><MiniPhrase en="Next" am="ቀጣይ"/></button></nav>:null;
}
function ParticipantSheet({code,amount,onClose,returnFocusRef}:{code:string;amount:string;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>}){
 const {language}=useMiniLocale(),am=language==='am',[page,setPage]=useState(1);
 const query=usePrivateQuery<ResultBreakdown>(`/api/results/${encodeURIComponent(code)}/breakdown?amount=${encodeURIComponent(amount)}&page=${page}`),data=query.data?.kind==='participants'?query.data:null;
 return <AccountSheet title={<MiniPhrase en="Bid details" am="የጨረታ ዝርዝር"/>} onClose={onClose} returnFocusRef={returnFocusRef}><PrivateState query={query}/>{data&&<>
  <h3 className={styles.amountTitle}>{formatAuctionBid(data.amount,data.auction.terms.ruleVersion)}</h3><div className={styles.stats}><span><strong>{data.bidCount}</strong><MiniPhrase en="Bids" am="ጨረታዎች"/></span><span><strong>{data.playerCount}</strong><MiniPhrase en="Players" am="ተጫራቾች"/></span><span><strong>{data.unique?<MiniPhrase en="Unique" am="ልዩ"/>:<MiniPhrase en="Repeated" am="የተደገመ"/>}</strong>{data.winner&&<MiniPhrase en={isSubmissionFeeOnly(data.auction.terms.ruleVersion)?'Winning number':'Winning amount'} am={isSubmissionFeeOnly(data.auction.terms.ruleVersion)?'ያሸነፈው ቁጥር':'ያሸነፈው መጠን'}/>}</span></div>
  <h3 className={styles.subheading}><MiniPhrase en="Participants" am="ተሳታፊዎች"/></h3><ul className={styles.people}>{data.participants.map((person,index)=><li key={`${person.submittedAt}:${index}`}><strong>{person.phoneMasked??(am?'ስሙ ያልተገለጸ ተጫራች':'Anonymous bidder')}</strong><time dateTime={person.submittedAt}>{new Date(person.submittedAt).toLocaleString(am?'am-ET':'en-ET',{dateStyle:'medium',timeStyle:'medium',timeZone:'Africa/Addis_Ababa'})}</time></li>)}</ul>
  <Pager page={data.page} totalPages={data.totalPages} change={setPage}/>
 </>}</AccountSheet>;
}
export default function ResultSheet({code,onClose,returnFocusRef}:{code:string;onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>}){
 const {language}=useMiniLocale(),am=language==='am',[page,setPage]=useState(1),[sort,setSort]=useState<'amount'|'picked'>('amount'),[jump,setJump]=useState(false),[amount,setAmount]=useState<string|null>(null),amountTrigger=useRef<HTMLElement|null>(null);
 const query=usePrivateQuery<ResultBreakdown>(`/api/results/${encodeURIComponent(code)}/breakdown?page=${page}&sort=${sort}${jump?'&jump=winner':''}`),data=query.data?.kind==='amounts'?query.data:null;
 return <><AccountSheet title={<MiniPhrase en="Final result" am="የመጨረሻ ውጤት"/>} onClose={onClose} returnFocusRef={returnFocusRef}><PrivateState query={query}/>{data&&<>
  <div className={styles.detailPhoto}><CatalogImage src={data.auction.product.images[0]?.path} alt={am?data.auction.product.titleAm||data.auction.product.title:data.auction.product.title}/></div><h3 className={styles.title}>{am?data.auction.product.titleAm||data.auction.product.title:data.auction.product.title}</h3>
  <p className={styles.date}><MiniPhrase en="Announced" am="የታወጀው"/> {new Date(data.announcedAt).toLocaleString(am?'am-ET':'en-ET',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'})}</p>
  <dl className={styles.facts}><div><dt><MiniPhrase en={isSubmissionFeeOnly(data.auction.terms.ruleVersion)?'Winning number':'Winning amount'} am={isSubmissionFeeOnly(data.auction.terms.ruleVersion)?'ያሸነፈው ቁጥር':'ያሸነፈው መጠን'}/></dt><dd>{data.auction.result?.winningPoints?formatAuctionBid(data.auction.result.winningPoints,data.auction.terms.ruleVersion):'—'}</dd></div><div><dt><MiniPhrase en="Winner" am="አሸናፊ"/></dt><dd>{data.auction.result?.winnerPhoneMasked??(am?'ስሙ ያልተገለጸ ተጫራች':'Anonymous bidder')}</dd></div><div><dt><MiniPhrase en="Auction ID" am="የጨረታ መለያ"/></dt><dd>{data.auction.code}</dd></div><div><dt><MiniPhrase en="Winning entry fee" am="የአሸናፊው ጨረታ ክፍያ"/></dt><dd>{formatEtb(data.entryFee)}</dd></div></dl>
  <div className={styles.stats}><span><strong>{data.totalBids}</strong><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></span><span><strong>{data.totalPlayers}</strong><MiniPhrase en="Total players" am="ጠቅላላ ተጫራቾች"/></span></div>
  <p className={styles.note}>{isSubmissionFeeOnly(data.auction.terms.ruleVersion)?<MiniPhrase en="Bid numbers are not charged. Only the disclosed submission fee applies." am="የጨረታ ቁጥሮች ገንዘብ አይደሉም። የተገለጸው የማስገቢያ ክፍያ ብቻ ይከፈላል።"/>:<MiniPhrase en="This auction follows its own frozen fee and winner-payment terms." am="ይህ ጨረታ የራሱን የተቀመጡ የክፍያ እና የአሸናፊ ክፍያ ውሎች ይከተላል።"/>}{data.variableFees&&<> <MiniPhrase en="Submission fees varied; the fee above belongs to the winning entry." am="የማስገቢያ ክፍያዎች ይለያዩ ነበር፤ ከላይ የሚታየው ያሸነፈው ጨረታ ክፍያ ነው።"/></>}</p>
  <div className={styles.controls}><div role="group" aria-label={am?'የቁጥሮች ቅደም ተከተል':'Amount sorting'}>{(['amount','picked'] as const).map(value=><button key={value} aria-pressed={sort===value} onClick={()=>{setSort(value);setPage(1);setJump(false)}}><MiniPhrase en={value==='amount'?'By amount':'Most picked'} am={value==='amount'?'በቁጥር':'በብዛት የተመረጡ'}/></button>)}</div>{data.auction.result?.winningPoints&&<button onClick={()=>setJump(true)}><Trophy size={14}/><MiniPhrase en={isSubmissionFeeOnly(data.auction.terms.ruleVersion)?'Winning number':'Winning amount'} am={isSubmissionFeeOnly(data.auction.terms.ruleVersion)?'ያሸነፈው ቁጥር':'ያሸነፈው መጠን'}/></button>}</div>
  <ul className={styles.amounts}>{data.amounts.map(row=><li key={row.amount}><button data-result-amount={row.amount} onClick={event=>{amountTrigger.current=event.currentTarget;setAmount(row.amount)}}><strong>{formatAuctionBid(row.amount,data.auction.terms.ruleVersion)}</strong><span>{row.bidCount} <MiniPhrase en="bids" am="ጨረታዎች"/></span>{row.unique&&<small><MiniPhrase en="Unique" am="ልዩ"/></small>}{row.winner&&<small className={styles.winner}><MiniPhrase en="Winner" am="አሸናፊ"/></small>}<ChevronRight size={16} aria-hidden="true"/></button></li>)}</ul>
  <Pager page={data.page} totalPages={data.totalPages} change={value=>{setPage(value);setJump(false)}}/>
 </>}</AccountSheet>{amount!==null&&<ParticipantSheet key={`${code}:${amount}`} code={code} amount={amount} onClose={()=>setAmount(null)} returnFocusRef={amountTrigger}/>}</>;
}
