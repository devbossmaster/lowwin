'use client';
import Link from 'next/link';
import {useEffect,useId,useState} from 'react';
import {Check,Clock3,LoaderCircle,Smartphone,TriangleAlert} from 'lucide-react';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {bidPaymentApplicationDelayed,bidPaymentCanRetry,bidPaymentCanRetryOriginal,bidPaymentProgressPhase,maskedBidPaymentPhone} from '@/lib/bid-payment-progress';
import {chapaPaymentReasonMessage,chapaRequestReasonMessage} from '@/lib/chapa-payment-reason';
import {chapaConfirmed} from '@/lib/chapa-client';
import {formatEtb} from '@/lib/money';
import {AccountSheetFooter} from './account-sheet';
import {ChapaPaymentStatus,useChapaPayment,useChapaPaymentClock} from './chapa-payment';
import {useMiniLocale} from './mini-locale';
import styles from './bid-payment-progress.module.css';

type Props={payment:ReturnType<typeof useChapaPayment>;amount:string|null;provider:string;phone:string;onRetry:()=>void;onClose?:()=>void;footerPortal:boolean};
const names:Record<string,string>={telebirr:'telebirr',mpesa:'M-Pesa',cbebirr:'CBE Birr'};

/** Presentation only. Initialization, verification, polling and ownership all
 * remain on the same payment hook used by the bid checkout. */
export function WalletTopUpProgress({payment,amount,provider,phone,onRetry,onClose,footerPortal}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const id=useId(),[otp,setOtp]=useState(''),order=payment.order,now=useChapaPaymentClock(order);
 const phase=bidPaymentProgressPhase({...payment,now}),busy=payment.busy||payment.restoring,success=!!order&&chapaConfirmed(order),terminal=phase==='terminal';
 const otpNeeded=phase==='authorization'&&order?.authType==='OTP';
 const total=order?.amount??amount,masked=maskedBidPaymentPhone(order?.payerPhoneMasked??phone),method=order?.paymentMethod??provider;
 const canRetry=terminal&&bidPaymentCanRetry(order)&&payment.canStartAgain&&!busy;
 const canRetryOriginal=phase==='uncertain'&&!busy&&!!payment.directAttempt&&bidPaymentCanRetryOriginal(order);
 const delayed=phase==='confirming'&&bidPaymentApplicationDelayed(order,payment.paused,now);
 const canCheck=(phase==='uncertain'||delayed)&&(!!order||!!payment.recoveryId)&&!success&&!terminal;
 const invalidOtp=otpNeeded&&payment.errorCode==='INVALID_OTP';
 const reason=order?chapaPaymentReasonMessage(order,am)??chapaRequestReasonMessage(order.initializationReasonCode,am):null;
 const requestReason=chapaRequestReasonMessage(payment.errorCode,am);
 const heading=success?text('Wallet credited','ገንዘቡ በዋሌትዎ ገብቷል'):terminal?text(order?.status==='CANCELLED'?'Payment cancelled':order?.status==='EXPIRED'?'Payment expired':'Payment not completed',order?.status==='CANCELLED'?'ክፍያው ተሰርዟል':order?.status==='EXPIRED'?'የክፍያው ጊዜ አልፏል':'ክፍያው አልተጠናቀቀም'):phase==='authorization'?text(otpNeeded?'Enter your verification code':'Approve on your phone',otpNeeded?'የማረጋገጫ ኮዱን ያስገቡ':'በስልክዎ ይፍቀዱ'):phase==='connecting'?text('Connecting to your provider','ከክፍያ አቅራቢዎ ጋር በመገናኘት ላይ'):phase==='uncertain'?text(order?.status==='NEEDS_REVIEW'?'Payment needs review':'Payment not confirmed yet',order?.status==='NEEDS_REVIEW'?'ክፍያው ማረጋገጥ ያስፈልገዋል':'ክፍያው ገና አልተረጋገጠም'):text('Confirming your payment','ክፍያዎን በማረጋገጥ ላይ');
 const message=success?text('Your available balance has been updated.','ለመጠቀም የሚችሉት ቀሪ ሂሳብ ተዘምኗል።'):terminal?text('Try again to review your amount and payment details.','መጠኑንና የክፍያ ዝርዝሮችዎን ለማየት እንደገና ይሞክሩ።'):phase==='authorization'?text(otpNeeded?'Use the one-time code from your provider. Never enter your wallet PIN here.':'Complete the prompt on your phone. This sheet updates automatically.',otpNeeded?'ከክፍያ አቅራቢዎ የተላከውን ኮድ ብቻ ያስገቡ። የዋሌት PIN እዚህ አያስገቡ።':'በስልክዎ የመጣውን ጥያቄ ያረጋግጡ። ይህ ገጽ በራሱ ይዘምናል።'):phase==='uncertain'?text('Check this original payment before paying again.','እንደገና ከመክፈልዎ በፊት ይህንኑ ክፍያ ያረጋግጡ።'):order?.providerStatus==='SUCCESS'?text('Payment received. We are confirming your wallet credit.','ክፍያዎ ደርሷል። የዋሌት ገቢዎን በማረጋገጥ ላይ ነን።'):text('Waiting for your provider’s response. This sheet updates automatically.','የክፍያ አቅራቢዎን ምላሽ እየጠበቅን ነው። ይህ ገጽ በራሱ ይዘምናል።');
 const activeStage=success||phase==='confirming'?2:phase==='authorization'?1:0;
 useEffect(()=>{setOtp('')},[order?.id]);
 useEffect(()=>{payment.markPresented('feedback');if(phase==='authorization')payment.markPresented('authorization');if(success)payment.markPresented('confirmed')},[phase,success,payment.markPresented]);
 if(order&&order.chargeType!=='DIRECT')return <ChapaPaymentStatus payment={payment} onNavigate={onClose} onStartAgain={onRetry} readOnly={!success&&!bidPaymentCanRetry(order)}/>;
 const actions=<div className={styles.actions}>
  {success&&<button className={styles.primary} type="button" onClick={onRetry}>{text('Top up again','እንደገና ገንዘብ ያስገቡ')}</button>}
  {terminal&&<button className={styles.primary} type="button" disabled={!canRetry} onClick={onRetry}>{text('Try again','እንደገና ይሞክሩ')}</button>}
  {otpNeeded&&<button className={styles.primary} type="submit" form={`${id}-otp-form`} disabled={busy||!/^\d{4,10}$/.test(otp)}>{busy&&<LoaderCircle className={styles.spin} size={17}/>} {text('Confirm code','ኮዱን ያረጋግጡ')}</button>}
  {canRetryOriginal&&<button className={styles.primary} type="button" onClick={()=>void payment.createDirect(payment.directAttempt!)}>{text('Retry original request','የመጀመሪያውን ጥያቄ ይድገሙ')}</button>}
  {canCheck&&!canRetryOriginal&&<button className={styles.primary} type="button" disabled={busy} onClick={()=>void payment.check()}>{busy&&<LoaderCircle className={styles.spin} size={17}/>} {text('Check payment','ክፍያውን ያረጋግጡ')}</button>}
  <div className={styles.secondaryActions}>{canCheck&&canRetryOriginal?<button type="button" disabled={busy} onClick={()=>void payment.check()}>{text('Check payment','ክፍያውን ያረጋግጡ')}</button>:phase==='uncertain'&&<Link href="/payments" prefetch={false} onClick={onClose}>{text('Transactions','ግብይቶች')}</Link>}{onClose?<button type="button" className={!success&&!terminal&&!otpNeeded&&!canCheck&&!canRetryOriginal?styles.closeOnly:undefined} onClick={onClose}>{text('Close','ዝጋ')}</button>:<Link href="/profile#wallet">{text('Back to wallet','ወደ ዋሌት ይመለሱ')}</Link>}</div>
 </div>;
 return <><section className={styles.progress} data-wallet-payment-progress={phase} data-direct-approval={phase==='authorization'?otpNeeded?'otp':'phone':phase==='connecting'?'connecting':phase==='confirming'?'confirming':undefined} aria-labelledby={`${id}-title`}>
  <div className={styles.brand}><img src={LOWWIN_LOGO_SRC} width={26} height={26} alt=""/><span>Lowwin</span>{order?.mode==='test'&&<small>{text('Test payment','የሙከራ ክፍያ')}</small>}</div>
  <ol className={styles.stages} aria-label={text('Payment progress','የክፍያ ሂደት')}>{[text('Connect','ግንኙነት'),text('Approve','ፈቃድ'),text('Confirm','ማረጋገጫ')].map((label,index)=><li key={index} aria-current={index===activeStage?'step':undefined}><span aria-hidden="true"/>{label}</li>)}</ol>
  <div className={styles.status} data-tone={success?'success':terminal?'error':phase==='uncertain'?'attention':'pending'}><div className={styles.stateIcon} aria-hidden="true">{success?<Check size={27}/>:terminal?<TriangleAlert size={26}/>:phase==='uncertain'||delayed?<Clock3 size={26}/>:phase==='authorization'?<Smartphone size={27}/>:<LoaderCircle className={styles.spin} size={27}/>}</div><div role="status" aria-live="polite" aria-atomic="true"><h3 id={`${id}-title`}>{heading}</h3><p>{message}</p></div></div>
  {(reason||requestReason||invalidOtp)&&!success&&<p className={styles.reason} role="alert" data-payment-reason>{invalidOtp?text('That code was not accepted. Check it and try again.','ኮዱ አልተቀበለም። ያረጋግጡና እንደገና ይሞክሩ።'):reason??requestReason}</p>}
  <dl className={styles.summary}><div><dt>{text('For','ለ')}</dt><dd>{text('Wallet top-up','የዋሌት ገቢ')}</dd></div><div className={styles.total}><dt>{text('Total','ጠቅላላ')}</dt><dd>{total===null?'—':formatEtb(total)}</dd></div><div><dt>{text('Payment','ክፍያ')}</dt><dd>{names[method]??text('Payment provider','የክፍያ አቅራቢ')}{masked&&<span className={styles.phone}>{masked}</span>}</dd></div></dl>
  {otpNeeded&&<form className={styles.otp} id={`${id}-otp-form`} onSubmit={event=>{event.preventDefault();if(busy||!/^\d{4,10}$/.test(otp))return;const code=otp;setOtp('');void payment.authorize(code)}}><label htmlFor={`${id}-otp`}>{text('One-time code','የአንድ ጊዜ ኮድ')}</label><input id={`${id}-otp`} type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={otp} disabled={busy} aria-invalid={invalidOtp||undefined} onChange={event=>{if(/^\d{0,10}$/.test(event.target.value))setOtp(event.target.value)}}/></form>}
  {order&&<details className={styles.reference}><summary>{text('Payment reference','የክፍያ ማጣቀሻ')}</summary><p>{order.merchantReference??order.id}</p></details>}
 </section>{footerPortal?<AccountSheetFooter>{actions}</AccountSheetFooter>:actions}</>;
}
