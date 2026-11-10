'use client';
import Link from 'next/link';
import {useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,LockKeyhole,ShieldCheck,Smartphone} from 'lucide-react';
import {ChapaPaymentStatus,useChapaPayment,useChapaPaymentClock} from './chapa-payment';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {normalizePaymentPhone,type BidBatchQuote,type DirectPaymentMethods} from '@/lib/bid-batch-client';
import {chapaConfirmed,chapaDirectRequestRejected,chapaPollingPaused,chapaRecoverable} from '@/lib/chapa-client';
import {chapaLongWait} from '@/lib/chapa-status';
import {paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {etbToCents,formatEtb} from '@/lib/money';
import {chapaPaymentReasonMessage,chapaRequestReasonMessage} from '@/lib/chapa-payment-reason';
import styles from './bid-payment-sheet.module.css';
import ui from './batch-checkout.module.css';

const logos:Record<string,string>={telebirr:'/icons/payments/telebirr.jpg',mpesa:'/icons/payments/mpesa.png',cbebirr:'/icons/payments/cbebirr.svg'};
const methodNames:Record<string,string>={telebirr:'telebirr',mpesa:'M-Pesa',cbebirr:'CBE Birr',ebirr:'eBirr'};
type Props={payment:ReturnType<typeof useChapaPayment>;purpose:'BID'|'TOP_UP';amount:string;batch?:BidBatchQuote;onBack?:()=>void;onClose?:()=>void;onStartAgain?:()=>void};
const localPhone=(value:string)=>normalizePaymentPhone(value)?.slice(3)??value;

/** The mobile wallet owns its native PIN prompt. Only a provider-requested OTP
 * may appear here; it exists in memory for one explicit authorization request. */
export default function DirectCheckout({payment,purpose,amount,batch,onBack,onClose,onStartAgain}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en,id=useId();
 const [phone,setPhone]=useState(''),[method,setMethod]=useState(''),[otp,setOtp]=useState('');
 const operationKey=useRef(crypto.randomUUID()),order=payment.order;
 const now=useChapaPaymentClock(order);
 useEffect(()=>{if(!payment.started)operationKey.current=crypto.randomUUID()},[payment.started]);
 const methods=usePrivateQuery<DirectPaymentMethods>(`/api/payments/chapa/methods?amountCents=${etbToCents(amount)}`,{enabled:!payment.started,freshnessMs:60000});
 useEffect(()=>{if(methods.data&&!methods.data.methods.some(item=>item.slug===method))setMethod(methods.data.methods[0]?.slug??'')},[methods.data,method]);
 useEffect(()=>{setOtp('')},[order?.id]);
 const phoneProblem=paymentPhoneProblem(phone,method),normalized=phoneProblem?null:normalizePaymentPhone(phone),selected=methods.data?.methods.find(item=>item.slug===method);
 const submit=()=>{if(!normalized||!selected||payment.busy)return;void payment.createDirect(purpose==='BID'&&batch?{key:operationKey.current,purpose:'BID',batchId:batch.id,quoteHash:batch.quoteHash,paymentMethod:method,phone:normalized}:{key:operationKey.current,purpose:'TOP_UP',amount,paymentMethod:method,phone:normalized})};
 const authorizationReady=order?.chargeType==='DIRECT'&&!!order.authorizationReference;
 useEffect(()=>{
  if(payment.started)payment.markPresented('feedback');
  if(authorizationReady)payment.markPresented('authorization');
  if(order&&chapaConfirmed(order))payment.markPresented('confirmed');
 },[payment.started,payment.markPresented,authorizationReady,order]);
 const otpNeeded=authorizationReady&&order.authType==='OTP'&&chapaRecoverable(order)&&order.providerStatus!=='SUCCESS'&&!chapaConfirmed(order);
 const phoneApproval=authorizationReady&&order.authType==='USSD'&&chapaRecoverable(order)&&order.providerStatus!=='SUCCESS'&&!chapaConfirmed(order);
 const connecting=!authorizationReady&&order?.providerStatus!=='SUCCESS';
 const waiting=order?.chargeType==='DIRECT'&&chapaRecoverable(order)&&!chapaDirectRequestRejected(order)&&!chapaConfirmed(order)&&!payment.paused&&!chapaPollingPaused(order,now)&&!chapaLongWait(order,now)&&order.verificationState!=='MISMATCH'&&order.status!=='NEEDS_REVIEW'&&(!authorizationReady||order.verificationState!=='UNAVAILABLE');
 if(payment.started&&order?.chargeType!=='DIRECT'&&order)return <ChapaPaymentStatus payment={payment} onNavigate={onClose} onStartAgain={onStartAgain}/>;
 if(payment.started&&order&&!waiting)return <><ChapaPaymentStatus payment={payment} onNavigate={onClose} onStartAgain={onStartAgain}/>{order.batchNumbers&&<p className={ui.numbers}>{order.batchNumbers.join(' · ')}</p>}</>;
 const total=formatEtb(order?.amount??amount);
 const providerReason=order?chapaPaymentReasonMessage(order,am):null;
 const errors=<>
  {(payment.error||providerReason)&&<p role="alert" className={styles.error} data-payment-reason>{payment.error||providerReason}</p>}
  {order?.initializationReasonCode&&<p role="alert" className={styles.error}>{chapaRequestReasonMessage(order.initializationReasonCode,am)} {text('Check the original payment in Transactions before starting another charge.','ሌላ ክፍያ ከመጀመርዎ በፊት የመጀመሪያውን ክፍያ በግብይቶች ይመልከቱ።')}</p>}
 </>;
 return <section className={ui.checkout} data-direct-checkout>
  {onBack&&!payment.started&&<button className={ui.back} type="button" onClick={onBack}><ArrowLeft size={16}/> {text('Back to review','ወደ ግምገማ ይመለሱ')}</button>}
  {!payment.started&&<p className={ui.checkoutIntro}>{text('Choose a payment method and approve the request on your phone.','የክፍያ መንገድ ይምረጡና በስልክዎ የሚመጣውን ጥያቄ ያረጋግጡ።')}</p>}
  {!payment.started?<form className={ui.paymentPanel} id={id} onSubmit={event=>{event.preventDefault();submit()}}>
   <label className={ui.label} htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label>
   <div className={ui.phoneField} data-valid={!!normalized}>
    <span className={ui.country} aria-hidden="true"><svg viewBox="0 0 30 21" width="25" height="18"><path fill="#159447" d="M0 0h30v7H0z"/><path fill="#f7d33b" d="M0 7h30v7H0z"/><path fill="#df3837" d="M0 14h30v7H0z"/><circle cx="15" cy="10.5" r="6.3" fill="#1473b9"/><path d="m15 5.2 3.1 9.6-8.2-6h10.2l-8.2 6Z" fill="none" stroke="#f7d33b" strokeWidth=".65"/></svg> +251</span>
    <input className={ui.phoneInput} id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="off" value={phone} maxLength={18} onChange={event=>setPhone(localPhone(event.target.value))} placeholder="7•• / 9•• ••• •••" aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={`${id}-phone-help${phone&&phoneProblem?' '+id+'-phone-error':''}`}/>
    {normalized&&<ShieldCheck className={ui.phoneVerified} size={23} aria-hidden="true"/>}
   </div>
   {phone&&phoneProblem&&<p id={`${id}-phone-error`} className={styles.error} data-payment-phone-error role="alert">{paymentPhoneProblemMessage(phoneProblem,am)}</p>}
   <p className="sr-only" id={`${id}-phone-help`}>{text('Enter the phone registered with your selected payment method. Your Lowwin account phone stays the same.','በመረጡት የክፍያ መንገድ የተመዘገበውን ስልክ ያስገቡ። የLowwin መለያዎ ስልክ አይቀየርም።')}</p>
   <fieldset className={ui.providerGrid}><legend className="sr-only">{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend>
    {methods.data?.methods.map(item=><label key={item.slug} data-selected={method===item.slug}>
     <input type="radio" name={`${id}-method`} value={item.slug} checked={method===item.slug} onChange={()=>setMethod(item.slug)}/>
     <span className={ui.providerMark}>{logos[item.slug]?<img src={logos[item.slug]} alt="" width={64} height={48}/>:<strong>{methodNames[item.slug]??item.name}</strong>}{method===item.slug&&<span className={ui.selectedMark}><Check size={13} strokeWidth={3} aria-hidden="true"/></span>}</span>
     <span className={ui.providerName}>{methodNames[item.slug]??item.name}</span>
    </label>)}
   </fieldset>
   {methods.fetching&&!methods.data&&<div role="status" className={ui.methodsLoading}><LoaderCircle className={ui.spin} size={24}/><span>{text('Loading payment methods…','የክፍያ መንገዶች በመጫን ላይ…')}</span></div>}
   {(methods.error||methods.data&&!methods.data.methods.length)&&<p className={styles.error} role="status">{text('No supported payment method is available for this amount. Use your wallet or try again later.','ለዚህ መጠን የክፍያ መንገድ አይገኝም። ዋሌትዎን ይጠቀሙ ወይም በኋላ ይሞክሩ።')} <button className={styles.inlineRetry} type="button" onClick={methods.reload}>{text('Retry','እንደገና')}</button></p>}
   {batch&&<p className={ui.paymentSummary}>{text(`${batch.entryCount} bid${batch.entryCount===1?'':'s'} · submission fees`,`${batch.entryCount} ጨረታዎች · የማስገቢያ ክፍያ`)}</p>}
   {errors}
   <button className={`${styles.payButton} ${ui.checkoutPay}`} data-payment-action type="submit" disabled={!selected||!normalized||methods.fetching||payment.busy}>{text(`Pay ${total}`,`${total} ይክፈሉ`)}</button>
  </form>:<div className={`${ui.paymentPanel} ${ui.waitingPanel}`} data-direct-approval={otpNeeded?'otp':phoneApproval?'phone':connecting?'connecting':'confirming'}>
   <div className={ui.approval}>
    {otpNeeded||phoneApproval?<Smartphone size={34} className={ui.approvalPhone} aria-hidden="true"/>:<LoaderCircle size={42} className={ui.spin} aria-hidden="true"/>}
    <h3 role="status">{text(otpNeeded?'Enter your verification code':phoneApproval?'Approve the payment on your phone':connecting?'Connecting to your payment provider…':'Confirming your payment…',otpNeeded?'የማረጋገጫ ኮዱን ያስገቡ':phoneApproval?'ክፍያውን በስልክዎ ይፍቀዱ':connecting?'ከክፍያ አቅራቢዎ ጋር በመገናኘት ላይ…':'ክፍያዎን በማረጋገጥ ላይ…')}</h3>
    <p>{text(otpNeeded?'Use the one-time code sent by your payment provider. Never enter your wallet PIN here.':phoneApproval?'Complete the payment prompt on your phone. This sheet updates automatically.':connecting?'The payment request is not confirmed yet. We are checking the original request.':order?.providerStatus==='SUCCESS'?'Your payment was received. We are updating Lowwin.':'We are checking the latest response from your payment provider. This sheet updates automatically.',otpNeeded?'ከክፍያ አቅራቢዎ የተላከውን ኮድ ብቻ ያስገቡ። የዋሌት ፒን እዚህ አያስገቡ።':phoneApproval?'በስልክዎ የመጣውን የክፍያ ጥያቄ ያረጋግጡ። ይህ ገጽ በራሱ ይዘምናል።':connecting?'የክፍያ ጥያቄው ገና አልተረጋገጠም። የመጀመሪያውን ጥያቄ በማረጋገጥ ላይ ነን።':order?.providerStatus==='SUCCESS'?'ክፍያዎ ደርሷል። Lowwinን በማዘመን ላይ ነን።':'ከክፍያ አቅራቢዎ የሚመጣውን ምላሽ በማረጋገጥ ላይ ነን። ይህ ገጽ በራሱ ይዘምናል።')}</p>
    <span className={ui.approvalDetails}>{order?.payerPhoneMasked&&<>{order.payerPhoneMasked} · </>}{total}</span>
   </div>
   {otpNeeded&&<form className={ui.otpForm} onSubmit={event=>{event.preventDefault();const code=otp;setOtp('');void payment.authorize(code)}}><label className={ui.label} htmlFor={`${id}-otp`}>{text('One-time code','የአንድ ጊዜ ኮድ')}</label><input className={ui.phone} id={`${id}-otp`} type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={otp} onChange={event=>{if(/^\d{0,10}$/.test(event.target.value))setOtp(event.target.value)}} disabled={payment.busy}/><button className={styles.payButton} type="submit" disabled={payment.busy||!/^\d{4,10}$/.test(otp)}>{payment.busy&&<LoaderCircle className={ui.spin} size={18}/>} {text('Confirm OTP','ኮዱን ያረጋግጡ')}</button></form>}
   {(!order||!order.authorizationReference)&&!payment.busy&&payment.directAttempt&&<button className={styles.checkPayment} type="button" onClick={()=>void payment.createDirect(payment.directAttempt!)}>{text('Retry original request','የመጀመሪያውን ጥያቄ ይድገሙ')}</button>}
   {errors}
   <Link className={ui.historyLink} href="/payments" onClick={onClose}>{text('View Transactions','ግብይቶችን ይመልከቱ')}</Link>
  </div>}
  <p className={ui.secureNote}><LockKeyhole size={16} aria-hidden="true"/>{text('Secure payment · your PIN stays on your phone','ደህንነቱ የተጠበቀ ክፍያ · ፒንዎ በስልክዎ ብቻ')}</p>
 </section>;
}
