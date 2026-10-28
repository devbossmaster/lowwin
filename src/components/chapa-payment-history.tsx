'use client';
import Link from 'next/link';
import {ArrowUpRight,RefreshCw} from 'lucide-react';
import {useState} from 'react';
import {usePrivateQuery} from './private-query';
import {useMiniLocale} from './mini-locale';
import {LoadingSpinner} from './loading-spinner';
import {chapaCheckoutUrl,chapaConfirmed,type ChapaCheckoutView} from '@/lib/chapa-client';
import {chapaReturnPath} from '@/lib/chapa-return-link';
import {prepareChapaNavigation} from '@/lib/chapa-navigation';
import {formatEtb} from '@/lib/money';
import styles from './chapa-payment-history.module.css';

/** Owned server records survive closing a sheet or reopening the Mini App. */
export function ChapaPaymentHistory(){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const query=usePrivateQuery<{items:ChapaCheckoutView[]}>('/api/payments/chapa/checkouts?purpose=TOP_UP'),[openError,setOpenError]=useState('');
 if(query.status!=='authenticated')return null;
 const label=(order:ChapaCheckoutView)=>chapaConfirmed(order)?order.purpose==='BID'&&order.status==='BID_ACCEPTED'?text('Bid accepted','ጨረታው ተቀብሏል'):text('Wallet credited','ገንዘቡ ወደ ዋሌት ገብቷል'):['FAILED','CANCELLED','EXPIRED','BLOCKED','INCOMPLETE'].includes(order.status)?text('Not completed','አልተጠናቀቀም'):text('Pending','በመጠባበቅ ላይ');
 const date=new Intl.DateTimeFormat(am?'am-ET':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
 return <section id="wallet-payments" className={styles.history} aria-labelledby="wallet-payments-title" data-payment-history>
  <div className={styles.heading}><h2 id="wallet-payments-title">{text('Payment history','የክፍያ ታሪክ')}</h2><button type="button" onClick={query.reload} disabled={query.fetching} aria-label={text('Refresh payments','ክፍያዎችን ያድሱ')}><RefreshCw size={16} aria-hidden="true"/></button></div>
  {!query.data&&!query.error&&<p className={styles.notice} role="status"><LoadingSpinner decorative/>{text('Loading payments…','ክፍያዎች በመጫን ላይ…')}</p>}
  {query.error&&<p className={styles.notice} role="status">{text(query.data?'Showing saved payments. Refresh failed.':'Payments could not load.',query.data?'የተቀመጡ ክፍያዎች ይታያሉ። ማደስ አልተሳካም።':'ክፍያዎችን ማምጣት አልተቻለም።')} <button type="button" onClick={query.reload}>{text('Retry','እንደገና')}</button></p>}
  {query.data&&!query.data.items.length&&<p className={styles.notice}>{text('Your Chapa payments will appear here.','የChapa ክፍያዎችዎ እዚህ ይታያሉ።')}</p>}
  {query.data&&<ul className={styles.list}>{query.data.items.map(order=>{
   const path=chapaReturnPath(order.id);if(!path)return null;
   const url=['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status)&&!chapaConfirmed(order)?chapaCheckoutUrl(order.checkoutUrl):null;
   return <li key={order.id} data-payment-id={order.id}>
    <div className={styles.details}><strong>{formatEtb(order.amount)}</strong><span>{text(order.purpose==='TOP_UP'?'Wallet top-up':'Bid payment',order.purpose==='TOP_UP'?'የዋሌት ገቢ':'የጨረታ ክፍያ')}{order.mode==='test'&&<> · {text('Test','ሙከራ')}</>}</span><time dateTime={order.createdAt}>{date.format(new Date(order.createdAt))}</time></div>
    <div className={styles.actions}><span className={styles.status} data-confirmed={chapaConfirmed(order)}>{label(order)}</span>{url?<><a href={url} target="_blank" rel="noopener noreferrer" onClick={event=>{event.preventDefault();setOpenError('');const navigation=prepareChapaNavigation();try{if(!navigation.open(url))setOpenError(text('Chapa could not open. Try again.','Chapa መክፈት አልተቻለም። እንደገና ይሞክሩ።'))}catch{setOpenError(text('Chapa could not open. Try again.','Chapa መክፈት አልተቻለም። እንደገና ይሞክሩ።'))}finally{navigation.cancel()}}}>{text('Resume','ይቀጥሉ')}<ArrowUpRight size={13} aria-hidden="true"/></a><Link href={path} prefetch={false} className={styles.secondary}>{text('Status','ሁኔታ')}</Link></>:<Link href={path} prefetch={false}>{text(chapaConfirmed(order)?'Details':'Check payment',chapaConfirmed(order)?'ዝርዝር':'ክፍያ ያረጋግጡ')}</Link>}</div>
   </li>;
  })}</ul>}
  {openError&&<p className={styles.error} role="alert">{openError}</p>}
 </section>;
}
