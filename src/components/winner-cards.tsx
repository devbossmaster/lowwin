'use client';
import {useEffect,useRef,useState} from 'react';
import {CatalogImage} from './catalog-image';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {WinnerBanner,publishedWinnerBannerPath,winnerBannerData} from './winner-banner';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import styles from './winner-results.module.css';
import ResultSheet from './result-sheet';
import {useTelegram} from './telegram-provider';
import {seedAuctionQuery} from './auction-query';
import {CalendarDays} from 'lucide-react';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {WinnerCarousel} from './winner-carousel';
import {maskPhoneDisplay} from '@/lib/phone-mask';
import {winnersQueryUrl} from '@/lib/catalog-query';
import {readPrivateQuery} from './private-query-cache';
export function WinnerCards({items,carousel=false,allowDemo=false}:{items:CatalogAuction[];carousel?:boolean;allowDemo?:boolean}){
 const {language}=useMiniLocale(),{queryIdentity,status,me,openRegistration}=useTelegram(),am=language==='am',trigger=useRef<HTMLElement|null>(null),[selected,setSelected]=useState<CatalogAuction|null>(null);
 const winners=items.filter(item=>(!item.isDemo||allowDemo)&&item.status==='closed'&&item.result?.source==='SETTLED'&&item.result.outcome==='WINNER');
 useEffect(()=>{for(const item of items)if(item.status==='closed')seedAuctionQuery(queryIdentity,item)},[items,queryIdentity]);
 if(!winners.length)return <p className={styles.empty}><MiniPhrase en="Confirmed winners will appear here after settlement is final." am="ውጤቱ ከተጠናቀቀ በኋላ የተረጋገጡ አሸናፊዎች እዚህ ይታያሉ።"/></p>;
 const cards=winners.map(item=>{
  const title=am?item.product.titleAm||item.product.title:item.product.title,result=item.result!;
  const homeBanner=carousel?publishedWinnerBannerPath(item):null;
  const name=result.winnerDisplay||(!carousel?result.winnerUsername:null),phone=maskPhoneDisplay(result.winnerPhoneMasked);
  const identity=carousel?[name,phone].filter(Boolean).join(' · ')||undefined:undefined;
  return <button className={styles.card} type="button" key={item.code} data-winner-code={item.code} onClick={event=>{
   if(status!=='authenticated'||!me?.user?.id||!queryIdentity){openRegistration();return}
   trigger.current=event.currentTarget.hasAttribute('data-winner-copy')?event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[data-winner-code="${CSS.escape(item.code)}"]:not([data-winner-copy])`)??null:event.currentTarget;
   const snapshot=carousel?readPrivateQuery<{items:CatalogAuction[]}>(queryIdentity,winnersQueryUrl()):null;
   const confirmed=snapshot?.fresh?snapshot.value.items.find(candidate=>candidate.code===item.code&&candidate.result?.source==='SETTLED'&&candidate.result.publishedAt===result.publishedAt):undefined;
   setSelected(confirmed??item);
  }} aria-label={`${am?'ውጤት':'Result'}: ${title}`} aria-description={identity}>
   {!homeBanner&&winnerBannerData(item)?<WinnerBanner auction={item} compact={carousel}/>:<div className={styles.photo} data-photo={homeBanner?'banner':undefined}>
    <CatalogImage src={homeBanner??item.product.images[0]?.path} alt={title} sizes={carousel?'(max-width:371px) 208px, (max-width:500px) 56vw, 280px':undefined}/>
    {!homeBanner&&<span className={styles.badge}><MiniPhrase en={item.isDemo?'Demo winner':'Winner'} am={item.isDemo?'የሙከራ አሸናፊ':'አሸናፊ'}/></span>}
   </div>}
   <div className={styles.cardBody}><h3>{title}</h3>
    {(!carousel||name||phone)&&<p className={styles.cardIdentity}>
     {name?<strong className={styles.cardWinnerName}>{name}</strong>:!carousel&&<MiniPhrase en="Confirmed winner" am="የተረጋገጠ አሸናፊ"/>}
     {phone&&<span dir="ltr">{phone}</span>}
    </p>}
    {!carousel&&<p><span className={styles.reference}>#{item.code}</span><MiniPhrase en="Auction result" am="የጨረታ ውጤት"/></p>}
    <p className={styles.cardDate}>{!carousel&&<CalendarDays size={12} aria-hidden="true"/>}<MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.publishedAt}>{formatAddisTimestamp(result.publishedAt,am?'am-ET':'en-GB')}</time></p>
   </div>
  </button>;
 });
 return <>{carousel?<WinnerCarousel dialogOpen={!!selected}>{cards}</WinnerCarousel>:<div className={styles.cards}>{cards}</div>}{selected&&status==='authenticated'&&!!me?.user?.id&&queryIdentity&&<ResultSheet key={`${queryIdentity}:${selected.code}`} auction={selected} onClose={()=>setSelected(null)} returnFocusRef={trigger}/>}</>;
}
