'use client';
import {useEffect,useState} from 'react';
import type {AuctionRefundView} from '@/lib/auction-refund';
import {formatEtb} from '@/lib/money';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import styles from './auction-refund-notice.module.css';

export function RefundStatus({refund}:{refund:AuctionRefundView}){
 const {language}=useMiniLocale(),am=language==='am',t=(en:string,a:string)=>am?a:en;
 return <div className={styles.notice} role="status" data-auction-refund={refund.status}>
  <strong>{t(refund.status==='pending'?'Returning your fees':'Refund completed',refund.status==='pending'?'ክፍያዎ በመመለስ ላይ ነው':'ክፍያዎ ተመልሷል')}</strong>
  {refund.status==='pending'?<p>{t('The auction was cancelled. Your paid fees are queued for return to your Lowwin wallet.','ጨረታው ተሰርዟል። የከፈሉት ክፍያ ወደ Lowwin ዋሌትዎ በመመለስ ላይ ነው።')}</p>:<>
   <p>{t('Cash returned','የተመለሰ ገንዘብ')}: {formatEtb(refund.cash)}{Number(refund.bonus)>0&&<> · {t('Bonus restored','የተመለሰ ጉርሻ')}: {formatEtb(refund.bonus)}</>}</p>
   {Number(refund.bonusExpired)>0&&<p>{t('Expired promotional credit was not converted to cash.','ጊዜው ያለፈበት ጉርሻ ወደ ገንዘብ አልተቀየረም።')}</p>}
  </>}
 </div>;
}
export function AuctionRefundNotice({code}:{code:string}){
 const [watch,setWatch]=useState(true),query=usePrivateQuery<{refund:AuctionRefundView|null}>(`/api/my-bids/refunds?auction=${encodeURIComponent(code)}`,{pollMs:watch?3000:0,freshnessMs:watch?2000:300000,cancelOnUnmount:true});
 useEffect(()=>setWatch(true),[code]);
 // A pre-cancellation read may have cached null. Only explicit committed
 // completion is final; keep absent/pending results briefly fresh and watched.
 useEffect(()=>{if(query.data?.refund?.status==='completed')setWatch(false)},[query.data]);
 if(!query.data?.refund)return null;
 return <RefundStatus refund={query.data.refund}/>;
}
