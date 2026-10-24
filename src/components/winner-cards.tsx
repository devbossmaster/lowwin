'use client';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {Trophy} from 'lucide-react';
import {CatalogImage} from './catalog-image';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {formatAuctionBid} from '@/lib/money';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import styles from './winner-results.module.css';
const ResultSheet=dynamic(()=>import('./result-sheet'));
export function WinnerCards({items,carousel=false}:{items:CatalogAuction[];carousel?:boolean}){
 const {language}=useMiniLocale(),am=language==='am',trigger=useRef<HTMLElement|null>(null),[selected,setSelected]=useState<string|null>(null);
 const winners=items.filter(item=>!item.isDemo&&item.status==='closed'&&item.result?.source==='SETTLED'&&item.result.outcome==='WINNER');
 if(!winners.length)return <p className={styles.empty}><MiniPhrase en="Confirmed winners will appear here after settlement is final." am="ውጤቱ ከተጠናቀቀ በኋላ የተረጋገጡ አሸናፊዎች እዚህ ይታያሉ።"/></p>;
 return <><div className={carousel?styles.carousel:styles.cards}>{winners.map(item=>{
  const title=am?item.product.titleAm||item.product.title:item.product.title,result=item.result!;
  return <button className={styles.card} type="button" key={item.code} onClick={event=>{trigger.current=event.currentTarget;setSelected(item.code)}} aria-label={`${am?'ውጤት':'Result'}: ${title}`}>
   <div className={styles.photo}><CatalogImage src={item.product.images[0]?.path} alt={title}/><span className={styles.badge}><Trophy size={12} aria-hidden="true"/><MiniPhrase en="Winner" am="አሸናፊ"/></span><span className={styles.winning}><small><MiniPhrase en={item.terms.ruleVersion==='lowest-unique-v4'?'Winning number':'Winning amount'} am={item.terms.ruleVersion==='lowest-unique-v4'?'ያሸነፈው ቁጥር':'ያሸነፈው መጠን'}/></small><strong>{formatAuctionBid(result.winningPoints!,item.terms.ruleVersion)}</strong></span></div>
   <div className={styles.cardBody}><h3>{title}</h3>{!carousel&&<p><MiniPhrase en="Auction ID" am="የጨረታ መለያ"/> · {item.code}</p>}<p><MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.closedAt}>{new Date(result.closedAt).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})}</time></p></div>
  </button>;
 })}</div>{selected&&<ResultSheet code={selected} onClose={()=>setSelected(null)} returnFocusRef={trigger}/>}</>;
}
