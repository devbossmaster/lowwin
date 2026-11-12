'use client';

import Link from 'next/link';
import {useEffect,useId} from 'react';
import {Check,LoaderCircle,Wallet} from 'lucide-react';
import {formatEtb} from '@/lib/money';
import {AccountSheetFooter} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import PaymentProgress,{type PaymentProgressProps} from './payment-progress';
import styles from './wallet-bid-progress.module.css';

export type {BidPaymentSummary} from './payment-progress';
type Props=PaymentProgressProps&{walletPayment?:boolean};

/** Internal wallet payments reuse the committed receipt and original command;
 * they never enter the provider-authorization presentation. */
export default function BidPaymentProgress({walletPayment=false,...props}:Props){
 return walletPayment?<WalletBidProgress {...props}/>:<PaymentProgress {...props}/>;
}

function WalletBidProgress({payment,preparing=false,walletRetry=false,receipt,onRetryWallet,onClose,footerPortal=true}:PaymentProgressProps){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en,id=useId();
 const committed=receipt?.batch.status==='ACCEPTED'&&receipt.receipts.length>0&&receipt.receipts.every(item=>!!item.bid.id)?receipt:null;
 const accepted=!!committed;
 const busy=preparing||payment.busy||payment.restoring;
 const uncertain=!accepted&&walletRetry&&!busy;
 const state=accepted?'success':uncertain?'uncertain':'paying';
 const phase=accepted?'success':uncertain?'uncertain':'preparing';
 const count=committed?.receipts.length??0;
 const total=committed?committed.payment?.total??committed.batch.total:null;
 const balance=committed?.wallet?.available;
 useEffect(()=>{payment.markPresented('feedback');if(accepted)payment.markPresented('confirmed')},[accepted,payment.markPresented]);
 const heading=accepted?text(count===1?'Bid accepted':`${count} bids accepted`,count===1?'ጨረታዎ ተቀብሏል':`${count} ጨረታዎች ተቀብለዋል`):uncertain?text('Wallet payment is processing','የዋሌት ክፍያው በመካሄድ ላይ ነው'):text('Paying from your wallet…','ከዋሌትዎ በመክፈል ላይ…');
 const message=accepted?text('Ready to view in My Bids.','በእኔ ጨረታዎች ማየት ይችላሉ።'):uncertain?text('The result is not confirmed yet. Retry the same request to retrieve it.','ውጤቱ እስካሁን አልተረጋገጠም። ውጤቱን ለማግኘት ይህንኑ ጥያቄ ይድገሙ።'):text('Accepting your selected bids.','የመረጧቸውን ጨረታዎች በመቀበል ላይ ነን።');
 const actions=accepted?<div className={styles.actions}>{onClose?<button type="button" className={styles.primary} onClick={onClose}>{text('Done','ተጠናቋል')}</button>:<Link href="/my-bids" className={styles.primary}>{text('Done','ተጠናቋል')}</Link>}</div>:uncertain?<div className={styles.actions}>{onRetryWallet&&<button type="button" className={styles.primary} onClick={onRetryWallet}>{text('Retry original payment','የመጀመሪያውን ክፍያ ይድገሙ')}</button>}{onClose&&<button type="button" className={styles.close} onClick={onClose}>{text('Close','ዝጋ')}</button>}</div>:null;
 return <>
  <section className={styles.progress} data-wallet-bid-progress={state} data-payment-progress={phase} data-bid-payment-progress={phase} data-payment-state={accepted?'confirmed':'pending'} aria-labelledby={`${id}-heading`}>
   <div className={styles.icon} aria-hidden="true">{accepted?<Check size={25}/>:<><Wallet size={24}/>{!uncertain&&<LoaderCircle size={17} className={styles.spin}/>}</>}</div>
   <div role="status" aria-live="polite" aria-atomic="true"><h3 id={`${id}-heading`}>{heading}</h3><p>{message}</p></div>
   {accepted&&<dl className={styles.receipt}><div><dt>{text('Paid from wallet','ከዋሌት የተከፈለ')}</dt><dd>{formatEtb(total!)}</dd></div>{balance!==undefined&&<div><dt>{text('Available balance','ለመጠቀም የሚችሉት ቀሪ ሂሳብ')}</dt><dd>{formatEtb(balance)}</dd></div>}</dl>}
  </section>
  {actions&&(footerPortal?<AccountSheetFooter>{actions}</AccountSheetFooter>:actions)}
 </>;
}
