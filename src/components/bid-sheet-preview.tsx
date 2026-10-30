'use client';
import type {CatalogAuction,listQuickAuctions} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './bid-payment-sheet.module.css';

export type BidSheetAuction=CatalogAuction|Awaited<ReturnType<typeof listQuickAuctions>>['items'][number];
export function isFullAuction(auction:BidSheetAuction):auction is CatalogAuction{return 'description' in auction.product}
export function BidSheetPreview({auction,publicDetailsReady=false,detailsReady=false,showFee=false,showStatus=true}:{auction:BidSheetAuction;publicDetailsReady?:boolean;detailsReady?:boolean;showFee?:boolean;showStatus?:boolean}){
 const {language}=useMiniLocale(),title=language==='am'?auction.product.titleAm||auction.product.title:auction.product.title;
 return <div data-sheet-preview={isFullAuction(auction)?'full':'quick'} data-sheet-public-details-ready={publicDetailsReady} data-sheet-details-ready={detailsReady}>
  <div className={styles.previewPhoto}><CatalogImage src={auction.product.images[0]?.path} alt={title}/></div>
  <div className={styles.productHeading}><h3 className={styles.productTitle}>{title}</h3>{showStatus&&<span className={styles.previewStatus}>{auction.status==='live'?<MiniPhrase en="Live" am="ቀጥታ"/>:auction.status==='upcoming'?<MiniPhrase en="Upcoming" am="በቅርብ"/>:<MiniPhrase en="Completed" am="ተጠናቋል"/>}</span>}</div>
  {showFee&&<div className={styles.feeStrip}><div><small><MiniPhrase en="Bid fee" am="የጨረታ ክፍያ"/></small><strong>{formatEtb(auction.terms.entryFeePoints)}</strong></div></div>}
 </div>;
}
