'use client';
import Link from 'next/link';
import {Check,LoaderCircle,RefreshCw} from 'lucide-react';
import {chapaCanResumeCheckout,chapaCheckoutUrl,chapaConfirmed} from '@/lib/chapa-client';
import {formatEtb} from '@/lib/money';
import {prepareChapaNavigation} from '@/lib/chapa-navigation';
import {useMiniLocale} from './mini-locale';
import type {useChapaPayment} from './chapa-payment';
import styles from './hosted-checkout-status.module.css';

/** Lowwin displays verified status; payment entry and authorization stay on Chapa. */
export function HostedCheckoutStatus({payment,onClose,onStartAgain}:{payment:ReturnType<typeof useChapaPayment>;onClose?:()=>void;onStartAgain?:()=>void}){
 const {language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en,order=payment.order;
 const confirmed=!!order&&chapaConfirmed(order),preserved=!!order?.fundsPreserved,failed=!!order&&['FAILED','CANCELLED','EXPIRED','BLOCKED','INCOMPLETE','FAILED_OR_CANCELLED'].includes(order.status);
 const applying=!confirmed&&order?.providerStatus==='SUCCESS',review=!confirmed&&(order?.status==='NEEDS_REVIEW'||payment.errorCode==='PAYMENT_ALREADY_PENDING');
 const url=order&&!confirmed&&!failed&&!applying&&!review&&Date.parse(order.expiresAt)>Date.now()?chapaCheckoutUrl(order.checkoutUrl,order.apiVersion):null;
 const resume=!review&&chapaCanResumeCheckout(payment.attempt,order);
 const pending=!confirmed&&!failed&&!review;
 return <section className={styles.status} data-hosted-checkout-status aria-busy={payment.busy||payment.restoring}>
  <div className={styles.icon} aria-hidden="true">{confirmed?<Check size={25}/>:payment.busy||payment.restoring?<LoaderCircle size={25} className={styles.spin}/>:<RefreshCw size={23}/>}</div>
  <div role="status" aria-live="polite"><h3>{confirmed?text(preserved?'Payment received':order.purpose==='BID'?'Bid accepted':'Wallet credited',preserved?'ክፍያው ደርሷል':order.purpose==='BID'?'ጨረታው ተቀብሏል':'ዋሌት ገብቷል'):payment.busy?text('Opening Chapa…','Chapa በመክፈት ላይ…'):payment.restoring?text('Checking your payment…','ክፍያዎን በማረጋገጥ ላይ…'):failed?text('Payment not completed','ክፍያው አልተጠናቀቀም'):applying?text('Updating your account…','መለያዎ በመዘመን ላይ…'):review?text('Payment needs confirmation','ክፍያው ማረጋገጥ ያስፈልገዋል'):text('Complete payment on Chapa','ክፍያውን በChapa ያጠናቅቁ')}</h3></div>
  {order&&<strong className={styles.amount}>{formatEtb(order.amount)}{order.mode==='test'&&<small>{text('Test payment','የሙከራ ክፍያ')}</small>}</strong>}
  <p>{confirmed?text(preserved?'Your payment is in your wallet. The bid could not be accepted.':order.purpose==='BID'?'Your bid is confirmed in My Bids.':'Your updated balance is ready to use.',preserved?'ገንዘቡ በዋሌትዎ ገብቷል። ጨረታው አልተቀበለም።':order.purpose==='BID'?'ጨረታዎ በእኔ ጨረታዎች ተረጋግጧል።':'የዘመነውን ቀሪ ሂሳብዎን መጠቀም ይችላሉ።'):failed?text('This payment was not completed.','ይህ ክፍያ አልተጠናቀቀም።'):text('Return here after checkout. We verify your payment securely before updating your account. If you already paid, check this same payment.','ክፍያውን ካጠናቀቁ በኋላ ወደዚህ ይመለሱ። መለያዎ ከመዘመኑ በፊት ክፍያው ይረጋገጣል። ከከፈሉ ይህንኑ ክፍያ ያረጋግጡ።')}</p>
  {payment.error&&<p className={styles.error} role="alert">{payment.error}</p>}
  <div className={styles.actions}>
   {url&&<a className={styles.primary} href={url} target="_blank" rel="noopener noreferrer" onClick={event=>{event.preventDefault();const navigation=prepareChapaNavigation();try{navigation.open(url)}finally{navigation.cancel()}}}>{text('Continue to Chapa','ወደ Chapa ቀጥል')}</a>}
   {resume&&<button className={styles.primary} type="button" disabled={payment.busy||payment.restoring} onClick={()=>void payment.create(payment.attempt!.intent)}>{text('Resume checkout','ክፍያውን ይቀጥሉ')}</button>}
   {(order||payment.recoveryId)&&!confirmed&&<button className={styles.secondary} type="button" disabled={payment.busy||payment.restoring} onClick={()=>void payment.check()}>{text('Check payment','ክፍያ ያረጋግጡ')}</button>}
   {!confirmed&&<Link className={styles.secondary} href="/payments" onClick={onClose}>{text('View Transactions','ግብይቶችን ይመልከቱ')}</Link>}
   {review&&<Link className={styles.secondary} href="/profile/support" onClick={onClose}>{text('Contact support','ድጋፍ ያግኙ')}</Link>}
   {confirmed&&<Link className={styles.primary} href={order.purpose==='BID'&&!preserved?'/my-bids':'/profile#wallet'} onClick={onClose}>{text(order.purpose==='BID'&&!preserved?'View My Bids':'Open wallet',order.purpose==='BID'&&!preserved?'የእኔ ጨረታዎች':'ዋሌት ክፈት')}</Link>}
   {onStartAgain&&payment.canStartAgain&&<button className={styles.secondary} type="button" onClick={onStartAgain}>{text(confirmed?'Top up again':'Try again',confirmed?'እንደገና ገንዘብ ያስገቡ':'እንደገና ይሞክሩ')}</button>}
   {onClose&&<button className={styles.secondary} type="button" onClick={onClose}>{text('Close','ዝጋ')}</button>}
  </div>
  {pending&&<small>{text('You can close this window and check Transactions later.','ይህን መስኮት ዘግተው በኋላ ግብይቶችን ማየት ይችላሉ።')}</small>}
  {order&&<details className={styles.reference}><summary>{text('Payment reference','የክፍያ ማጣቀሻ')}</summary><small>{order.merchantReference??order.id}</small></details>}
 </section>;
}
