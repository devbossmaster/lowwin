'use client';
import dynamic from 'next/dynamic';
import {useState,type RefObject} from 'react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {PersonalBidListItem} from '@/modules/profile/bid-list';
import {AccountSheet} from './account-sheet';
import {CatalogImage} from './catalog-image';
import {usePublicQuery} from './public-query';
import {auctionDetailUrl} from './auction-query';
import {useMiniLocale} from './mini-locale';
import type {BidSheetPhase} from './bid-sheet';
import styles from './my-bids-page.module.css';

const BidSheetContent=dynamic(()=>import('./bid-sheet-content'));
const ResultSheetContent=dynamic(()=>import('./result-sheet').then(module=>module.ResultSheetContent));

/** List rows carry recognition data only. Load a complete public detail on
 * selection; never seed this partial private projection as a complete auction. */
export default function MyBidAuctionSheet({bid,live,serverNow,onClose,returnFocusRef}:{bid:PersonalBidListItem;live:boolean;serverNow:string;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>}){
 const {language}=useMiniLocale(),am=language==='am',url=auctionDetailUrl(bid.auction.slug??bid.auction.code);
 const query=usePublicQuery<CatalogAuction>(url,{cancelOnUnmount:true});
 const title=am?bid.auction.titleAm||bid.auction.title:bid.auction.title;
 const [phase,setPhase]=useState<BidSheetPhase>('entry');
 const heading=live?(phase==='payment'?(am?'ክፍያ':'Payment'):phase==='receipt'?(am?'የጨረታ ደረሰኝ':'Bid receipt'):(am?'ጨረታዎን ያቅርቡ':'Place your bid')):(am?'የጨረታ ውጤት':'Auction result');
 return <AccountSheet title={heading} size={live?'payment':'content'} layout={live?'bid-entry':undefined} footerPortal={live} onClose={onClose} returnFocusRef={returnFocusRef}>
  {query.data?(live?<BidSheetContent auction={query.data} serverNow={serverNow} onClose={onClose} onPhaseChange={setPhase}/>:<ResultSheetContent auction={query.data}/>):<div className={styles.sheetLoading}><CatalogImage src={bid.auction.image?.path} alt=""/><h3>{title}</h3>{query.error?<><p role="alert">{am?'ጨረታውን መጫን አልተቻለም።':'Could not load this auction.'}</p><button type="button" onClick={query.reload}>{am?'እንደገና ሞክር':'Try again'}</button></>:<p role="status">{am?'በመጫን ላይ…':'Loading…'}</p>}</div>}
 </AccountSheet>;
}
