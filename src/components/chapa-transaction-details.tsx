'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useMiniLocale} from './mini-locale';
import {AccountSheet} from './account-sheet';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import {chapaConfirmed,type ChapaCheckoutView} from '@/lib/chapa-client';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import styles from './chapa-payment-history.module.css';

const DirectCheckout=dynamic(()=>import('./direct-checkout'),{ssr:false});
export function ChapaTransactionDetails({order,onClose,trigger}:{order:ChapaCheckoutView;onClose:()=>void;trigger:React.RefObject<HTMLElement|null>}){
 const payment=useChapaPayment('transaction:'+order.id,order.id),{language}=useMiniLocale(),am=language==='am',current=payment.order??order;
 const fresh=current.purpose==='TOP_UP'?'/wallet/deposit':current.auctionSlug?`/auctions/${current.auctionCode??current.auctionSlug}#bid-review`:null;
 return <AccountSheet size="payment" title={am?'የግብይት ዝርዝር':'Transaction details'} onClose={onClose} returnFocusRef={trigger}>
  {current.chargeType==='DIRECT'||current.apiVersion==='v1'?<DirectCheckout payment={payment} purpose={current.purpose} amount={current.amount} batch={current.batch??undefined} onClose={onClose}/>:<ChapaPaymentStatus payment={payment} onNavigate={onClose} readOnly/>}
  {fresh&&(bidPaymentCanRetry(current)||chapaConfirmed(current)&&current.purpose==='TOP_UP')&&<div className={styles.retry}><Link href={fresh} onClick={onClose}>{am?'አዲስ ክፍያ ይጀምሩ':'Start new checkout'}</Link></div>}
 </AccountSheet>;
}
