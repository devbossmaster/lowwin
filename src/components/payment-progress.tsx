'use client';

import Link from 'next/link';
import {useEffect,useId,useState} from 'react';
import {Check,Clock3,LoaderCircle,ShieldCheck,Smartphone,TriangleAlert} from 'lucide-react';
import type {BidBatchReceipt} from '@/lib/bid-batch-client';
import {bidPaymentApplicationDelayed,bidPaymentConnectionDelayed,bidPaymentCanRetry,bidPaymentCanRetryOriginal,bidPaymentProgressPhase,maskedBidPaymentPhone,type BidPaymentProgressPhase} from '@/lib/bid-payment-progress';
import {chapaPaymentReasonMessage,chapaRequestReasonMessage} from '@/lib/chapa-payment-reason';
import {formatEtb} from '@/lib/money';
import {AccountSheetFooter} from './account-sheet';
import {ChapaPaymentStatus,useChapaPayment,useChapaPaymentClock} from './chapa-payment';
import {useMiniLocale} from './mini-locale';
import styles from './bid-payment-progress.module.css';

export type BidPaymentSummary={auctionTitle:string;auctionTitleAm?:string|null;numbers:string[];total:string|null;provider:string|null;phone:string|null};
export type PaymentProgressProps={purpose?:'BID'|'TOP_UP';footerPortal?:boolean;payment:ReturnType<typeof useChapaPayment>;summary:BidPaymentSummary;preparing?:boolean;walletRetry?:boolean;receipt?:BidBatchReceipt|null;error?:string;onRetry:()=>void;onClose?:()=>void;onRetryWallet?:()=>void;onRetryOriginal?:()=>void};
const providerNames:Record<string,string>={telebirr:'telebirr',cbebirr:'CBE Birr',mpesa:'M-Pesa',ebirr:'eBirr',wallet:'Lowwin Wallet'};

/** Shared bid/deposit presentation. Every action reuses the original payment
 * hook; this surface never creates an operation key or a polling loop. */
export default function PaymentProgress({purpose='BID',footerPortal=true,payment,summary,preparing=false,walletRetry=false,receipt,error='',onRetry,onClose,onRetryWallet,onRetryOriginal}:PaymentProgressProps){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const id=useId(),[otp,setOtp]=useState(''),order=payment.order;
 const now=useChapaPaymentClock(order);
 const deposit=purpose==='TOP_UP';
 const phase=bidPaymentProgressPhase({...payment,preparing,walletRetry,hasReceipt:!deposit&&!!receipt,now});
 const busy=preparing||payment.busy||payment.restoring;
 const otpNeeded=phase==='authorization'&&order?.authType==='OTP';
 const finished=phase==='success'||phase==='preserved';
 const terminal=phase==='terminal';
 const numbers=receipt?.batch.lines.map(line=>line.number)??(order?.batchNumbers?.length?order.batchNumbers:order?.batch?.lines.map(line=>line.number))??(order?.bidNumber?[order.bidNumber]:summary.numbers);
 const total=receipt?.batch.total??order?.amount??summary.total;
 const provider=order?.paymentMethod??summary.provider;
 const providerName=provider==='coupon'?text('Coupon','ኩፖን'):provider==='wallet'?text('Lowwin Wallet','Lowwin ዋሌት'):provider?providerNames[provider]??text('Payment provider','የክፍያ አቅራቢ'):text('Payment provider','የክፍያ አቅራቢ');
 const phone=maskedBidPaymentPhone(order?.payerPhoneMasked??summary.phone);
 const title=am?order?.auctionTitleAm||summary.auctionTitleAm||order?.auctionTitle||summary.auctionTitle:order?.auctionTitle||summary.auctionTitle;
 const safeReason=order?chapaPaymentReasonMessage(order,am)??chapaRequestReasonMessage(order.initializationReasonCode,am):null;
 const requestReason=chapaRequestReasonMessage(payment.errorCode,am);
 const invalidOtp=otpNeeded&&payment.errorCode==='INVALID_OTP';
 const connectionDelayed=!finished&&!terminal&&!invalidOtp&&!requestReason&&bidPaymentConnectionDelayed({...payment,error:payment.error||error,now});
 const canRetry=terminal&&bidPaymentCanRetry(order)&&payment.canStartAgain&&!busy;
 const applicationDelayed=phase==='confirming'&&bidPaymentApplicationDelayed(order,payment.paused,now);
 const canRetryOriginal=phase==='uncertain'&&!busy&&!!payment.directAttempt&&bidPaymentCanRetryOriginal(order);
 const canCheck=(phase==='uncertain'||applicationDelayed||payment.paused&&phase==='authorization'&&!otpNeeded)&&(!!order||payment.started&&!payment.directAttempt&&!walletRetry)&&!finished&&!terminal;
 const normalWaiting=!finished&&!terminal&&!otpNeeded&&!canCheck&&!canRetryOriginal&&!(phase==='uncertain'&&walletRetry&&onRetryWallet)&&!!onClose;
 const headings:Record<BidPaymentProgressPhase,[string,string]>={
  preparing:['Processing your payment','ክፍያዎን በማስኬድ ላይ'],
  connecting:['Connecting to your provider','ከክፍያ አቅራቢዎ ጋር በመገናኘት ላይ'],
  authorization:[otpNeeded?'Enter your verification code':'Waiting for authorization…',otpNeeded?'የማረጋገጫ ኮዱን ያስገቡ':'የክፍያ ፈቃድን በመጠባበቅ ላይ…'],
  confirming:['Confirming your payment','ክፍያዎን በማረጋገጥ ላይ'],
  success:[deposit?'Wallet credited':numbers.length===1?'Bid accepted':`${numbers.length} bids accepted`,deposit?'ገንዘቡ በዋሌትዎ ገብቷል':numbers.length===1?'ጨረታዎ ተቀብሏል':`${numbers.length} ጨረታዎች ተቀብለዋል`],
  preserved:['Payment saved to your wallet','ክፍያው በዋሌትዎ ገብቷል'],
  terminal:[order?.reason==='INITIALIZATION_REJECTED'?'Payment could not start':order?.status==='CANCELLED'?'Payment cancelled':order?.status==='EXPIRED'?'Payment expired':'Payment not completed',order?.reason==='INITIALIZATION_REJECTED'?'ክፍያው ሊጀመር አልቻለም':order?.status==='CANCELLED'?'ክፍያው ተሰርዟል':order?.status==='EXPIRED'?'የክፍያው ጊዜ አልፏል':'ክፍያው አልተጠናቀቀም'],
  uncertain:[order?.status==='NEEDS_REVIEW'||order?.verificationState==='MISMATCH'?'Payment needs review':'Payment is processing…',order?.status==='NEEDS_REVIEW'||order?.verificationState==='MISMATCH'?'ክፍያው ማረጋገጥ ያስፈልገዋል':'ክፍያው በመካሄድ ላይ ነው…'],
 };
 const messages:Record<BidPaymentProgressPhase,[string,string]>={
  preparing:['Waiting for Lowwin to confirm your request.','Lowwin ጥያቄዎን እስኪያረጋግጥ እየጠበቅን ነው።'],
  connecting:['Contacting your provider about this payment.','ስለዚህ ክፍያ ከክፍያ አቅራቢዎ ጋር በመገናኘት ላይ ነን።'],
  authorization:[otpNeeded?'Use the one-time code from your provider. Never enter your wallet PIN here.':'Approve the payment request on your phone.',otpNeeded?'ከክፍያ አቅራቢዎ የተላከውን ኮድ ያስገቡ። የዋሌት PIN እዚህ አያስገቡ።':'በስልክዎ የመጣውን የክፍያ ጥያቄ ያጽድቁ።'],
  confirming:[order?.providerStatus==='SUCCESS'?(deposit?'Payment received. We are confirming your wallet credit.':'Payment received. Waiting for Lowwin to accept your bids.'):'Waiting for your provider’s confirmation. This page updates automatically.',order?.providerStatus==='SUCCESS'?(deposit?'ክፍያዎ ደርሷል። የዋሌት ገቢዎን በማረጋገጥ ላይ ነን።':'ክፍያዎ ደርሷል። Lowwin ጨረታዎችዎን እስኪቀበል እየጠበቅን ነው።'):'የክፍያ አቅራቢዎን ማረጋገጫ በመጠባበቅ ላይ ነን። ይህ ገጽ በራሱ ይዘምናል።'],
  success:[deposit?'Your available balance has been updated.':'Your bids are ready in My Bids.',deposit?'ለመጠቀም የሚችሉት ቀሪ ሂሳብ ተዘምኗል።':'ጨረታዎችዎን በእኔ ጨረታዎች ማየት ይችላሉ።'],
  preserved:['Your bids were not accepted. The payment is available in your Lowwin wallet.','ጨረታዎችዎ አልተቀበሉም። ክፍያው በLowwin ዋሌትዎ ውስጥ ይገኛል።'],
  terminal:[deposit?'Try again to review your amount and payment details.':'Try again to review your bids and payment details.',deposit?'መጠኑንና የክፍያ ዝርዝሮችዎን ለማየት እንደገና ይሞክሩ።':'ጨረታዎችዎንና የክፍያ ዝርዝሮችዎን ለማየት እንደገና ይሞክሩ።'],
  uncertain:[walletRetry?'Confirm the result by retrying the original payment.':'Check this original payment before paying again.',walletRetry?'የመጀመሪያውን ክፍያ እንደገና በመሞከር ውጤቱን ያረጋግጡ።':'እንደገና ከመክፈልዎ በፊት ይህንኑ ክፍያ ያረጋግጡ።'],
 };
 useEffect(()=>{setOtp('')},[order?.id]);
 useEffect(()=>{
  payment.markPresented('feedback');
  if(phase==='authorization')payment.markPresented('authorization');
  if(phase==='success'||phase==='preserved')payment.markPresented('confirmed');
 },[phase,payment.markPresented]);

 // Keep historical hosted recovery on its established shared path.
 if(order&&order.chargeType!=='DIRECT')return <ChapaPaymentStatus payment={payment} onNavigate={onClose} onStartAgain={onRetry} readOnly={!bidPaymentCanRetry(order)}/>;

 const renderActions=(actions:React.ReactNode)=>footerPortal?<AccountSheetFooter>{actions}</AccountSheetFooter>:actions;
 return <>
  <section className={styles.progress} data-payment-progress={phase} data-bid-payment-progress={!deposit?phase:undefined} data-wallet-payment-progress={deposit?phase:undefined} data-direct-approval={phase==='authorization'?otpNeeded?'otp':'phone':phase==='connecting'?'connecting':phase==='confirming'?'confirming':undefined} data-payment-state={terminal?'failed':phase==='success'?'confirmed':phase==='uncertain'?'pending':phase} aria-labelledby={`${id}-heading`}>
   <div className={styles.status} data-tone={terminal?'error':phase==='uncertain'?'attention':finished?'success':'pending'}>
    <div className={styles.stateIcon} aria-hidden="true">{finished?<Check size={27}/>:terminal?<TriangleAlert size={26}/>:phase==='uncertain'||applicationDelayed?<Clock3 size={26}/>:otpNeeded?<Smartphone size={27}/>:<LoaderCircle className={styles.spin} size={27} data-bid-submitting={phase==='preparing'||undefined}/>}</div>
    <div role="status" aria-live="polite" aria-atomic="true"><h3 id={`${id}-heading`}>{text(...headings[phase])}</h3><p>{text(...messages[phase])}</p></div>
   </div>
   {!finished&&!terminal&&phase!=='uncertain'&&<div className={styles.activity} aria-hidden="true"><span/></div>}
   {(safeReason||requestReason||invalidOtp)&&!finished&&<p className={styles.reason} role="alert" data-payment-reason>{invalidOtp?text('That code was not accepted. Check the code and try again.','ኮዱ አልተቀበለም። ኮዱን ያረጋግጡና እንደገና ይሞክሩ።'):safeReason??requestReason}</p>}
   {connectionDelayed&&<p className={styles.connection} role="status" data-payment-connection>{text('Checking is delayed. We’ll resume on this same payment.','ማረጋገጡ ዘግይቷል። ይህንኑ ክፍያ ማረጋገጥ እንቀጥላለን።')}</p>}
   <dl className={styles.summary}>
    {deposit?<div><dt>{text('For','ለ')}</dt><dd>{text('Wallet top-up','የዋሌት ገቢ')}</dd></div>:<><div><dt>{text('Auction','ጨረታ')}</dt><dd className={styles.auction}>{title}</dd></div><div><dt>{text(numbers.length===1?'Bid amount':'Bids','የጨረታ መጠን')}</dt><dd>{numbers.length===1?numbers[0]:numbers.length?text(`${numbers.length} selected`,`${numbers.length} ተመርጠዋል`):'—'}</dd></div></>}
    <div className={styles.total}><dt>{text(finished?'Paid':'Total payable',finished?'የተከፈለ':'ጠቅላላ ክፍያ')}</dt><dd>{total===null?'—':formatEtb(total)}</dd></div>
    <div><dt>{text('Payment','ክፍያ')}</dt><dd>{providerName}{phone&&<span className={styles.phone}>{phone}</span>}</dd></div>
   </dl>
   {otpNeeded&&<form className={styles.otp} id={`${id}-otp-form`} onSubmit={event=>{event.preventDefault();if(busy||!/^\d{4,10}$/.test(otp))return;const code=otp;setOtp('');void payment.authorize(code)}}>
    <label htmlFor={`${id}-otp`}>{text('One-time code','የአንድ ጊዜ ኮድ')}</label>
    <input id={`${id}-otp`} type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={otp} disabled={busy} aria-invalid={invalidOtp||undefined} onChange={event=>{if(/^\d{0,10}$/.test(event.target.value))setOtp(event.target.value)}}/>
   </form>}
   <p className={styles.security}><ShieldCheck size={14}/>{text('Secure payment · Lowwin','የተጠበቀ ክፍያ · Lowwin')}{order?.mode==='test'&&<span>{text('Test','ሙከራ')}</span>}</p>
  </section>
  {!normalWaiting&&renderActions(<div className={styles.actions}>
   {finished&&(onClose?<button type="button" className={styles.primary} onClick={onClose}>{text('Done','ተጠናቋል')}</button>:<Link className={styles.primary} href={deposit?'/profile#wallet':'/my-bids'}>{text('Done','ተጠናቋል')}</Link>)}
   {terminal&&<button type="button" className={styles.primary} disabled={!canRetry} onClick={onRetry}>{text('Try again','እንደገና ይሞክሩ')}</button>}
   {otpNeeded&&<button type="submit" form={`${id}-otp-form`} className={styles.primary} disabled={busy||!/^\d{4,10}$/.test(otp)}>{payment.busy&&<LoaderCircle className={styles.spin} size={17} aria-hidden="true"/>}{text('Confirm code','ኮዱን ያረጋግጡ')}</button>}
   {phase==='uncertain'&&walletRetry&&onRetryWallet&&<button type="button" className={styles.primary} disabled={busy} onClick={onRetryWallet}>{busy&&<LoaderCircle className={styles.spin} size={17} aria-hidden="true"/>}{text('Retry original payment','የመጀመሪያውን ክፍያ ይድገሙ')}</button>}
   {canRetryOriginal&&<button type="button" className={styles.primary} onClick={onRetryOriginal??(()=>void payment.createDirect(payment.directAttempt!))}>{text('Retry original request','የመጀመሪያውን ጥያቄ ይድገሙ')}</button>}
   {canCheck&&!canRetryOriginal&&<button type="button" className={styles.primary} disabled={busy} onClick={()=>void payment.check()}>{busy&&<LoaderCircle className={styles.spin} size={17} aria-hidden="true"/>}{text(busy?'Checking payment':'Check payment',busy?'ክፍያውን በማረጋገጥ ላይ':'ክፍያውን ያረጋግጡ')}</button>}
   <div className={styles.secondaryActions}>
    {canRetryOriginal&&canCheck&&order?<button type="button" disabled={busy} onClick={()=>void payment.check()}>{text('Check payment','ክፍያውን ያረጋግጡ')}</button>:phase==='uncertain'&&<Link href="/payments" prefetch={false} onClick={onClose}>{text('Transactions','ግብይቶች')}</Link>}
    {!normalWaiting&&!finished&&(onClose?<button type="button" onClick={onClose}>{text('Close','ዝጋ')}</button>:<Link href={deposit?'/profile#wallet':'/my-bids'}>{text('Close','ዝጋ')}</Link>)}
   </div>
  </div>)}
 </>;
}
