'use client';
import {useCallback,useRef,useState} from 'react';
import {AccountSheet} from './account-sheet';
import BidSheetContents from './bid-sheet-content';
import {usePrivateQuery} from './private-query';
import {auctionDetailUrl} from './auction-query';
import {useMiniLocale} from './mini-locale';
import type {BidSheetPhase} from './bid-sheet';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {ChapaDirectIntent} from '@/lib/bid-batch-client';
import type {ChapaCheckoutView} from '@/lib/chapa-client';
export default function TransactionBidRetry({order,draft,onClose,embedded=false,onPhaseChange,onDismissChange}:{order:ChapaCheckoutView;draft:ChapaDirectIntent|null;onClose:()=>void;embedded?:boolean;onPhaseChange?:(phase:BidSheetPhase)=>void;onDismissChange?:(action:(()=>void)|null)=>void}){
 const {language}=useMiniLocale(),am=language==='am',query=usePrivateQuery<CatalogAuction>(auctionDetailUrl(order.auctionSlug??'')),[phase,setPhase]=useState<BidSheetPhase>('entry');
 const dismiss=useRef<(()=>void)|null>(null),setDismiss=useCallback((action:(()=>void)|null)=>{dismiss.current=action},[]);
 const numbers=draft?.purpose==='BID'&&'numbers'in draft?draft.numbers:order.batchNumbers??(order.bidNumber?[order.bidNumber]:[]);
 const contents=query.data?<BidSheetContents auction={query.data} serverNow={new Date().toISOString()} onClose={onClose} onPhaseChange={onPhaseChange??setPhase} onDismissChange={onDismissChange??setDismiss} initialDraft={{numbers,method:draft?.paymentMethod??order.paymentMethod,phone:draft?.phone}}/>:<p role="status">{query.error?<button type="button" onClick={query.reload}>{am?'እንደገና':'Retry'}</button>:am?'ጨረታውን በመጫን ላይ…':'Loading auction…'}</p>;
 return embedded?contents:<AccountSheet size="payment" layout="bid-entry" presentation={phase==='payment'||phase==='receipt'?'centered':undefined} title={phase==='review'?(am?'ክፍያ':'Payment'):(am?'ጨረታዎን ያቅርቡ':'Place your bid')} footerPortal onClose={()=>dismiss.current?dismiss.current():onClose()}>{contents}</AccountSheet>;
}
