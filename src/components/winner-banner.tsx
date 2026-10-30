'use client';
import {Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {etbToCents,formatAuctionBid} from '@/lib/money';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './winner-banner.module.css';

type BannerAuction=Pick<CatalogAuction,'status'|'isDemo'|'product'|'result'|'terms'|'code'>;
/** Display only finalized facts. Photo publication is separately authorized by
 * the server; the client never infers a winner from an elapsed auction timer. */
export function winnerBannerData(auction:BannerAuction,am=false){
 const result=auction.result;
 if(auction.status!=='closed'||auction.isDemo||result?.source!=='SETTLED'||result.outcome!=='WINNER'||result.winningPoints==null)return null;
 let value:string;try{if(etbToCents(result.winningPoints)<=0n)return null;value=formatAuctionBid(result.winningPoints,auction.terms.ruleVersion)}catch{return null}
 const photo='winnerPhotoPath' in result&&typeof result.winnerPhotoPath==='string'&&/^\/api\/media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result.winnerPhotoPath)?result.winnerPhotoPath:null;
 return {title:am?auction.product.titleAm?.trim()||auction.product.title:auction.product.title,value,photo,image:photo??auction.product.images[0]?.path,phone:result.winnerPhoneMasked,number:auction.terms.ruleVersion==='lowest-unique-v4'};
}

/** Product-first announcement; an approved winner photograph replaces only
 * its right-hand image, leaving the canonical result and product intact. */
export function WinnerBanner({auction,className,priority=false}:{auction:BannerAuction;className?:string;priority?:boolean}){
 const {language}=useMiniLocale(),am=language==='am',data=winnerBannerData(auction,am);
 if(!data)return null;
 return <div className={`${styles.banner}${className?' '+className:''}`} data-winner-banner data-photo={data.photo?'winner':'product'}>
  <div className={styles.image}><CatalogImage src={data.image} alt={data.photo?(am?`${data.title} — የአሸናፊው ፎቶ`:`Winner photograph for ${data.title}`):data.title} className={data.photo?styles.person:styles.product} priority={priority} sizes="(max-width:480px) 50vw, 240px"/></div>
  <div className={styles.copy}>
   <span className={styles.badge}><Trophy size={12} aria-hidden="true"/><MiniPhrase en="Winner" am="አሸናፊ"/></span>
   <strong className={styles.title} title={data.title}>{data.title}</strong>
   <div className={styles.result}><span className={styles.resultLabel}><MiniPhrase en={data.number?'Winning number':'Winning amount'} am={data.number?'ያሸነፈው ቁጥር':'ያሸነፈው መጠን'}/></span><strong className={styles.value} data-long={data.value.length>12||undefined}>{data.value}</strong></div>
   <div className={styles.footer}><img src={LOWWIN_LOGO_SRC} width={19} height={19} alt="" decoding="async" aria-hidden="true"/><span>{data.phone??`#${auction.code}`}<small>LOWWIN</small></span></div>
  </div>
 </div>;
}
