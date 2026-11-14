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
import {CalendarDays} from 'lucide-react';
import {WinnerCarousel} from './winner-carousel';
export function WinnerCards({items,carousel=false,allowDemo=false}:{items:CatalogAuction[];carousel?:boolean;allowDemo?:boolean}){
 const {language}=useMiniLocale(),{queryIdentity,status,me,openRegistration}=useTelegram(),am=language==='am',trigger=useRef<HTMLElement|null>(null),[selected,setSelected]=useState<CatalogAuction|null>(null);
 const winners=items.filter(item=>(!item.isDemo||allowDemo)&&item.status==='closed'&&item.result?.source==='SETTLED'&&item.result.outcome==='WINNER');
 useEffect(()=>{for(const item of items)if(item.status==='closed')seedAuctionQuery(queryIdentity,item)},[items,queryIdentity]);
 if(!winners.length)return <p className={styles.empty}><MiniPhrase en="Confirmed winners will appear here after settlement is final." am="ውጤቱ ከተጠናቀቀ በኋላ የተረጋገጡ አሸናፊዎች እዚህ ይታያሉ።"/></p>;
 const cards=winners.map(item=>{
  const title=am?item.product.titleAm||item.product.title:item.product.title,result=item.result!;
  return <button className={styles.card} type="button" key={item.code} data-winner-code={item.code} onClick={event=>{if(status!=='authenticated'||!me?.user?.id||!queryIdentity){openRegistration();return}trigger.current=event.currentTarget.hasAttribute('data-winner-copy')?event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[data-winner-code="${CSS.escape(item.code)}"]:not([data-winner-copy])`)??null:event.currentTarget;setSelected(item)}} aria-label={`${am?'ውጤት':'Result'}: ${title}`}>
   {winnerBannerData(item)?<WinnerBanner auction={item} compact={carousel}/>:<div className={styles.photo}><CatalogImage src={item.product.images[0]?.path} alt={title}/><span className={styles.badge}><MiniPhrase en={item.isDemo?'Demo winner':'Winner'} am={item.isDemo?'የሙከራ አሸናፊ':'አሸናፊ'}/></span></div>}
   <div className={styles.cardBody}><h3>{title}</h3>{!carousel&&<><p className={styles.cardIdentity}>{result.winnerDisplay||result.winnerUsername||<MiniPhrase en="Confirmed winner" am="የተረጋገጠ አሸናፊ"/>}{result.winnerPhoneMasked&&<span>{result.winnerPhoneMasked}</span>}</p><p><span className={styles.reference}>#{item.code}</span><MiniPhrase en="Auction result" am="የጨረታ ውጤት"/></p></>}<p className={styles.cardDate}>{!carousel&&<CalendarDays size={12} aria-hidden="true"/>}<MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.publishedAt}>{new Date(result.publishedAt).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})}</time></p></div>
  </button>;
 });
 return <>{carousel?<WinnerCarousel dialogOpen={!!selected}>{cards}</WinnerCarousel>:<div className={styles.cards}>{cards}</div>}{selected&&status==='authenticated'&&!!me?.user?.id&&queryIdentity&&<ResultSheet key={`${queryIdentity}:${selected.code}`} auction={selected} onClose={()=>setSelected(null)} returnFocusRef={trigger}/>}</>;
}
