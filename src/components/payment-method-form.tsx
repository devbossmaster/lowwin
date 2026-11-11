'use client';
import {useId,type ReactNode} from 'react';
import {ArrowLeft,Check,CircleAlert,LoaderCircle,LockKeyhole,Wallet} from 'lucide-react';
import type {DirectPaymentMethods} from '@/lib/bid-batch-client';
import {etbToCents,formatEtb} from '@/lib/money';
import {normalizePaymentPhone,paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {AccountSheetFooter} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import styles from './payment-method-form.module.css';

const providers=[{slug:'telebirr',name:'telebirr',image:'/icons/payments/telebirr.jpg'},{slug:'cbebirr',name:'CBE Birr',image:'/icons/payments/cbebirr.svg'},{slug:'mpesa',name:'M-Pesa',image:'/icons/payments/mpesa.png'}] as const;
export type PaymentMethodFormProps={
 total:string;method:string|null;phone:string;onMethodChange:(method:string)=>void;onPhoneChange:(phone:string)=>void;
 methods:DirectPaymentMethods['methods'];wallet?:{available:string|null;unavailable?:boolean};
 busy?:boolean;payDisabled:boolean;payLabel:string;onPay:()=>void;onBack:()=>void;summary?:ReactNode;error?:ReactNode;
 footerPortal?:boolean;methodsLoading?:boolean;methodsError?:boolean;onReloadMethods?:()=>void;phoneRequired?:boolean;
};
/** A controlled payment form: selecting a method or editing a phone never sends a charge. */
export default function PaymentMethodForm({total,method,phone,onMethodChange,onPhoneChange,methods,wallet,busy=false,payDisabled,payLabel,onPay,onBack,summary,error,footerPortal=true,methodsLoading=false,methodsError=false,onReloadMethods,phoneRequired=true}:PaymentMethodFormProps){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en,id=useId(),usingWallet=method==='wallet';
 let amount:bigint|null=null;try{amount=etbToCents(total)}catch{}
 const supported=providers.filter(provider=>methods.some(item=>item.slug===provider.slug));
 const allowed=(slug:string)=>{const item=methods.find(item=>item.slug===slug);return !!item&&amount!==null&&(amount===0n&&!phoneRequired||(!item.minAmountCents||amount>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||amount<=BigInt(item.maxAmountCents)))};
 const phoneProblem=usingWallet||!phoneRequired?null:paymentPhoneProblem(phone,method??'');
 let walletInsufficient=false;try{walletInsufficient=!!wallet&&wallet.available!==null&&amount!==null&&etbToCents(wallet.available)<amount}catch{walletInsufficient=true}
 const selectedValid=usingWallet?!!wallet&&!wallet.unavailable&&wallet.available!==null&&!walletInsufficient:!!method&&allowed(method)&&(!phoneRequired||!phoneProblem&&!!normalizePaymentPhone(phone));
 const action=<button className={styles.pay} type="submit" form={id} data-payment-action disabled={busy||payDisabled||!selectedValid} aria-busy={busy}>{busy&&<LoaderCircle className={styles.spin} size={18} aria-hidden="true"/>}{busy?text('Processing…','በማስኬድ ላይ…'):payLabel}</button>;
 return <form id={id} className={styles.form} data-payment-method-form onSubmit={event=>{event.preventDefault();if(!busy&&!payDisabled&&selectedValid)onPay()}}>
  <div className={styles.heading}><button type="button" onClick={onBack} disabled={busy} aria-label={text('Back','ተመለስ')}><ArrowLeft size={18} aria-hidden="true"/></button><h3>{text('Payment method','የክፍያ መንገድ')}</h3></div>
  {summary&&<div className={styles.summary}>{summary}</div>}
  <div className={styles.phone}><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div className={styles.phoneField} data-disabled={usingWallet||!phoneRequired}>
   <span className={styles.country} aria-hidden="true"><svg viewBox="0 0 30 21" width="24" height="17"><path fill="#159447" d="M0 0h30v7H0z"/><path fill="#f7d33b" d="M0 7h30v7H0z"/><path fill="#df3837" d="M0 14h30v7H0z"/><circle cx="15" cy="10.5" r="6.3" fill="#1473b9"/><path d="m15 5.2 3.1 9.6-8.2-6h10.2l-8.2 6Z" fill="none" stroke="#f7d33b" strokeWidth=".65"/></svg><span>+251</span></span>
   <input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={18} value={phone} disabled={busy||usingWallet||!phoneRequired} onChange={event=>onPhoneChange(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value)} placeholder="7•• / 9•• ••• •••" aria-invalid={!!method&&!!phone&&!!phoneProblem||undefined} aria-describedby={`${id}-phone-help${method&&phone&&phoneProblem?' '+id+'-phone-error':''}`}/>
  </div><p id={`${id}-phone-help`} className={styles.hint}>{text(!phoneRequired?'No payment phone is needed for this submission.':usingWallet?'Your Lowwin Wallet does not need a payment phone.':'Use the phone registered with your payment provider.',!phoneRequired?'ለዚህ ጨረታ የክፍያ ስልክ አያስፈልግም።':usingWallet?'ለLowwin ዋሌት ክፍያ ስልክ አያስፈልግም።':'በክፍያ አቅራቢዎ የተመዘገበውን ስልክ ይጠቀሙ።')}</p>{method&&phone&&phoneProblem&&<p className={styles.error} role="alert" id={`${id}-phone-error`} data-payment-phone-error><CircleAlert size={14} aria-hidden="true"/>{paymentPhoneProblemMessage(phoneProblem,am)}</p>}</div>
  <fieldset className={styles.methods} disabled={busy} data-wallet-methods><legend>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={styles.grid}>
   {supported.map(provider=><label key={provider.slug} className={styles.method} data-provider={provider.slug} data-selected={method===provider.slug} data-unavailable={!allowed(provider.slug)}><input type="radio" name={`${id}-method`} value={provider.slug} checked={method===provider.slug} disabled={!allowed(provider.slug)} onChange={()=>onMethodChange(provider.slug)} aria-label={provider.name}/><img src={provider.image} alt="" width={52} height={32}/><strong>{provider.name}</strong>{method===provider.slug&&<span className={styles.check}><Check size={12} strokeWidth={3} aria-hidden="true"/></span>}</label>)}
   {wallet&&<label className={styles.method} data-provider="wallet" data-selected={usingWallet} data-unavailable={wallet.unavailable||wallet.available===null}><input type="radio" name={`${id}-method`} value="wallet" checked={usingWallet} disabled={wallet.unavailable||wallet.available===null} onChange={()=>onMethodChange('wallet')} aria-label={text('Lowwin Wallet','Lowwin ዋሌት')}/><Wallet className={styles.walletIcon} size={28} aria-hidden="true"/><strong>{text('Lowwin Wallet','Lowwin ዋሌት')}</strong><small>{wallet.available===null?text('Balance unavailable','ቀሪ ሂሳብ አይገኝም'):formatEtb(wallet.available)}</small>{usingWallet&&<span className={styles.check}><Check size={12} strokeWidth={3} aria-hidden="true"/></span>}</label>}
  </div></fieldset>
  {methodsLoading&&<p className={styles.loading} role="status"><LoaderCircle className={styles.spin} size={16}/>{text('Loading payment methods…','የክፍያ መንገዶች በመጫን ላይ…')}</p>}
  {(methodsError||!methodsLoading&&!supported.length&&!wallet)&&<p className={styles.error} role="status"><CircleAlert size={14} aria-hidden="true"/>{text('External payments are unavailable.','የውጭ ክፍያዎች ለጊዜው አይገኙም።')}{onReloadMethods&&<button type="button" className={styles.retry} onClick={onReloadMethods}>{text('Retry','እንደገና')}</button>}</p>}
  {usingWallet&&walletInsufficient&&<p className={styles.error} role="alert"><CircleAlert size={14} aria-hidden="true"/>{text('Your wallet balance is too low. Choose another method.','የዋሌትዎ ቀሪ ሂሳብ አይበቃም። ሌላ መንገድ ይምረጡ።')}</p>}
  {method&&!usingWallet&&!allowed(method)&&!methodsLoading&&<p className={styles.error} role="alert">{text('Choose a method available for this amount.','ለዚህ መጠን የሚገኝ የክፍያ መንገድ ይምረጡ።')}</p>}
  {error&&<div className={styles.error} role="alert">{error}</div>}
  <div className={styles.total} data-payment-total data-bid-total={wallet?'':undefined}><span>{text('Total payable','ጠቅላላ ክፍያ')}</span><strong>{formatEtb(total)}</strong></div>
  {footerPortal?<AccountSheetFooter>{action}</AccountSheetFooter>:action}
  <p className={styles.security}><LockKeyhole size={14} aria-hidden="true"/>{text('Secure payment · your PIN stays on your phone','ደህንነቱ የተጠበቀ ክፍያ · ፒንዎ በስልክዎ ብቻ')}</p>
 </form>;
}
