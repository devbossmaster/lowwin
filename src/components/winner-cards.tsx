'use client';
import {useEffect,useRef,useState} from 'react';
import {CatalogImage} from './catalog-image';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {WinnerBanner,winnerBannerData} from './winner-banner';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import styles from './winner-results.module.css';
import ResultSheet from './result-sheet';
import {useTelegram} from './telegram-provider';
import {seedAuctionQuery} from './auction-query';
export function WinnerCards({items,carousel=false,allowDemo=false}:{items:CatalogAuction[];carousel?:boolean;allowDemo?:boolean}){
 const {language}=useMiniLocale(),{queryIdentity}=useTelegram(),am=language==='am',trigger=useRef<HTMLElement|null>(null),[selected,setSelected]=useState<CatalogAuction|null>(null);
 const winners=items.filter(item=>(!item.isDemo||allowDemo)&&item.status==='closed'&&item.result?.source==='SETTLED'&&item.result.outcome==='WINNER');
 useEffect(()=>{for(const item of items)if(item.status==='closed')seedAuctionQuery(queryIdentity,item)},[items,queryIdentity]);
 if(!winners.length)return <p className={styles.empty}><MiniPhrase en="Confirmed winners will appear here after settlement is final." am="ውጤቱ ከተጠናቀቀ በኋላ የተረጋገጡ አሸናፊዎች እዚህ ይታያሉ።"/></p>;
 return <><div className={carousel?styles.carousel:styles.cards}>{winners.map(item=>{
  const title=am?item.product.titleAm||item.product.title:item.product.title,result=item.result!;
  return <button className={styles.card} type="button" key={item.code} onClick={event=>{trigger.current=event.currentTarget;setSelected(item)}} aria-label={`${am?'ውጤት':'Result'}: ${title}`}>
   {winnerBannerData(item)?<WinnerBanner auction={item}/>:<div className={styles.photo}><CatalogImage src={item.product.images[0]?.path} alt={title}/><span className={styles.badge}><MiniPhrase en={item.isDemo?'Demo winner':'Winner'} am={item.isDemo?'የሙከራ አሸናፊ':'አሸናፊ'}/></span></div>}
   <div className={styles.cardBody}><h3>{title}</h3>{!carousel&&<p><MiniPhrase en="Auction ID" am="የጨረታ መለያ"/> · {item.code}</p>}<p><MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.closedAt}>{new Date(result.closedAt).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})}</time></p></div>
  </button>;
 })}</div>{selected&&<ResultSheet key={`${queryIdentity}:${selected.code}`} auction={selected} onClose={()=>setSelected(null)} returnFocusRef={trigger}/>}</>;
}
