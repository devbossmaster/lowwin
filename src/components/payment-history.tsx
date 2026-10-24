'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {ChevronRight,CreditCard,RefreshCw} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery,PrivateState} from './private-query';
import {invalidatePrivateQueries} from './private-query-cache';
import {formatAuctionBid,formatEtb} from '@/lib/money';
import {paymentChannelName} from '@/lib/payment-channels';
import type {ArifPayCheckoutView} from '@/modules/payments/arifpay';
import styles from './account-pages.module.css';
const AccountSheet=dynamic(()=>import('./account-sheet').then(module=>module.AccountSheet));
const statuses:Record<string,[string,string]>={SUBMITTING:['Sending request','ጥያቄ በመላክ ላይ'],PENDING:['Pending verification','ማረጋገጥ በመጠባበቅ ላይ'],BID_ACCEPTED:['Bid accepted','ጨረታዎ ተቀብሏል'],NEEDS_REVIEW:['Needs review','ግምገማ ይፈልጋል'],FAILED:['Not completed','አልተጠናቀቀም'],CANCELLED:['Cancelled','ተሰርዟል'],EXPIRED:['Expired','ጊዜው አልፏል']};
export function PaymentHistory(){const {queryIdentity}=useTelegram();return <OwnPaymentHistory key={queryIdentity??'guest'}/>}
function OwnPaymentHistory(){
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const {queryIdentity,refreshMe}=useTelegram(),[selected,setSelected]=useState<ArifPayCheckoutView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const query=usePrivateQuery<{items:ArifPayCheckoutView[]}>('/api/payments/arifpay/checkouts',{pollMs:30000}),data=query.data;
  const receipt=selected;
  const canCheck=receipt&&(['SUBMITTING','PENDING'].includes(receipt.status)||receipt.status==='NEEDS_REVIEW'&&receipt.reason==='PROVIDER_CONFIRMATION_REQUIRED');
  const date=(value:string)=>new Date(value).toLocaleString(am?'am-ET':'en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  const status=(value:string)=>(statuses[value]??['Status unavailable','ሁኔታው አይገኝም'])[am?1:0];
  async function check(){
    if(!receipt||busy)return;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/payments/arifpay/checkouts/${receipt.id}`,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw Error('check');
      const updated=await response.json() as ArifPayCheckoutView;setSelected(current=>current?.id===updated.id?updated:current);
      if(queryIdentity)invalidatePrivateQueries(queryIdentity);
      window.dispatchEvent(new Event('lowin-alerts'));
      void refreshMe().catch(()=>{});
    }catch{setError(text('Could not refresh this payment. Keep the same payment ID and check again.','ክፍያውን ማደስ አልተቻለም። ይህንኑ የክፍያ መለያ ይያዙና እንደገና ያረጋግጡ።'))}finally{setBusy(false)}
  }
  return <><div className={styles.panelHead}><h2>{text('Recent bid payments','የቅርብ የጨረታ ክፍያዎች')}</h2><button className={styles.textButton} type="button" disabled={query.fetching} onClick={query.reload}><RefreshCw size={13} aria-hidden="true"/>{text('Refresh','አድስ')}</button></div><PrivateState query={query}/>
    {data&&!data.items.length&&<div className={styles.empty}><CreditCard size={26} aria-hidden="true"/><h2>{text('No bid payments yet','የጨረታ ክፍያዎች ገና የሉም')}</h2><p>{text('Your Telebirr and M-PESA bid payments will appear here.','የTelebirr እና የM-PESA ጨረታ ክፍያዎችዎ እዚህ ይታያሉ።')}</p></div>}
    <div className={styles.list}>{data?.items.map(item=><button className={styles.bidRow} type="button" key={item.id} onClick={()=>{setError('');setSelected(item)}}><CreditCard size={19} aria-hidden="true"/><span className={styles.rowBody}><span className={styles.rowTitle}>{paymentChannelName(item.channel)} · {formatEtb(item.fee)}</span><span className={styles.rowMeta}>{date(item.createdAt)}</span><span className={`${styles.pill} ${item.status==='BID_ACCEPTED'?styles.gold:''}`}>{status(item.status)}</span></span><ChevronRight size={17} aria-hidden="true"/></button>)}</div>
    {receipt&&query.status==='authenticated'&&<AccountSheet title={text('Bid payment','የጨረታ ክፍያ')} onClose={()=>{setSelected(null);setError('')}}><div className={styles.receiptTitle}><h3>{formatEtb(receipt.fee)}</h3><span className={`${styles.pill} ${receipt.status==='BID_ACCEPTED'?styles.gold:''}`}>{status(receipt.status)}</span></div><dl className={styles.facts}><div><dt>{text('Channel','የክፍያ መንገድ')}</dt><dd>{paymentChannelName(receipt.channel)}</dd></div><div><dt>{text('Chosen number','የመረጡት ቁጥር')}</dt><dd>{formatAuctionBid(receipt.amount,'lowest-unique-v4')}</dd></div><div><dt>{text('Created','የተፈጠረበት')}</dt><dd>{date(receipt.createdAt)}</dd></div><div><dt>{text('Payment ID','የክፍያ መለያ')}</dt><dd>{receipt.id}</dd></div></dl>
      {receipt.fundsPreserved?<p className={styles.notice}>{text('Your payment was verified but the bid was not accepted. Contact payment support with this ID for review. Do not pay again.','ክፍያዎ ተረጋግጧል፣ ግን ጨረታዎ አልተቀበለም። ለግምገማ በዚህ መለያ የክፍያ ድጋፍ ያግኙ። እንደገና አይክፈሉ።')}</p>:receipt.status==='NEEDS_REVIEW'?<p className={styles.notice}>{text('This payment needs review. Contact support with this payment ID. Do not pay again for the same entry.','ይህ ክፍያ ግምገማ ይፈልጋል። በዚህ የክፍያ መለያ ድጋፍ ያግኙ። ለዚሁ ጨረታ እንደገና አይክፈሉ።')}</p>:['SUBMITTING','PENDING'].includes(receipt.status)?<p className={styles.notice}>{text('Verification is still pending. Your bid is accepted only after the payment is independently confirmed. Check this same payment again.','ማረጋገጥ ገና በመጠባበቅ ላይ ነው። ጨረታዎ የሚቀበለው ክፍያው በገለልተኛ መንገድ ከተረጋገጠ በኋላ ብቻ ነው። ይህንኑ ክፍያ እንደገና ያረጋግጡ።')}</p>:null}
      {error&&<p className={styles.notice} role="alert">{error}</p>}{canCheck&&<button className={styles.action} data-payment-action type="button" disabled={busy} onClick={()=>void check()}>{busy?text('Checking payment…','ክፍያውን በማረጋገጥ ላይ…'):text('Check payment status','የክፍያ ሁኔታ አረጋግጥ')}</button>}
      <div className={styles.sheetLinks}><Link href={receipt.status==='BID_ACCEPTED'?'/my-bids':`/auctions/${receipt.auctionSlug}`} onClick={()=>setSelected(null)}>{receipt.status==='BID_ACCEPTED'?text('View My Bids','የእኔ ጨረታዎች'):text('View auction','ጨረታውን ይመልከቱ')}</Link><Link href="/profile/support" onClick={()=>setSelected(null)}>{text('Support','ድጋፍ')}</Link></div>
    </AccountSheet>}
  </>;
}
