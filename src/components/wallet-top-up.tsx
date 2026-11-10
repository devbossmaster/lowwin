'use client';
import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {Check,LoaderCircle,Wallet} from 'lucide-react';
import {AccountSheet,AccountSheetFooter} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {useChapaPayment} from './chapa-payment';
import {WalletTopUpProgress} from './wallet-top-up-progress';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {normalizePaymentPhone,type DirectPaymentMethods} from '@/lib/bid-batch-client';
import {paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {chapaConfirmed,type ChapaAvailability} from '@/lib/chapa-client';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {getMiniQueryClient} from './private-query-cache';
import {readPaymentRetryDraft} from '@/lib/payment-retry-draft';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './wallet-sheet.module.css';

const providers=[{slug:'telebirr',name:'telebirr',image:'/icons/payments/telebirr.jpg'},{slug:'cbebirr',name:'CBE Birr',image:'/icons/payments/cbebirr.svg'},{slug:'mpesa',name:'M-Pesa',image:'/icons/payments/mpesa.png'}] as const;
export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}
type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>;initialChapaId?:string;retryDraft?:{amount:string;paymentMethod:string;phone:string};embedded?:boolean;onProgressChange?:(active:boolean)=>void};
function TopUp({onClose,returnFocusRef,initialChapaId,retryDraft,embedded=false,onProgressChange}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,openRegistration}=useTelegram(),authenticated=!!queryIdentity;
 const payment=useChapaPayment('topup',initialChapaId,{retainOriginal:true}),original=payment.directAttempt?.purpose==='TOP_UP'?payment.directAttempt:null;
 const [amount,setAmount]=useState(()=>original?.amount??retryDraft?.amount??'100'),[method,setMethod]=useState(()=>original?.paymentMethod??retryDraft?.paymentMethod??''),[phone,setPhone]=useState(()=>normalizePaymentPhone(original?.phone??retryDraft?.phone??'')?.slice(3)??''),id=useId(),submitting=useRef(false);
 useEffect(()=>{onProgressChange?.(payment.started);return()=>onProgressChange?.(false)},[payment.started,onProgressChange]);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:authenticated,freshnessMs:15000});
 const availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{enabled:authenticated&&!payment.started,freshnessMs:15000});
 const methods=usePrivateQuery<DirectPaymentMethods>('/api/payments/chapa/methods',{enabled:authenticated&&!payment.started,freshnessMs:60000}),settings=availability.data;
 let cents=0n,total='0.00',valid=false;
 try{cents=etbToCents(amount);total=centsToEtb(cents);valid=!!settings&&/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amount)&&cents>=etbToCents(settings.minTopup)&&cents<=etbToCents(settings.maxTopup)}catch{}
 const enabledMethods=settings?.enabled?providers.filter(provider=>methods.data?.methods.some(item=>item.slug===provider.slug)):[];
 const allowed=(slug:string)=>{const item=methods.data?.methods.find(item=>item.slug===slug);return !!item&&valid&&(!item.minAmountCents||cents>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||cents<=BigInt(item.maxAmountCents))};
 const phoneProblem=paymentPhoneProblem(phone,method),normalizedPhone=phoneProblem?null:normalizePaymentPhone(phone);
 const ready=valid&&!!settings?.enabled&&!!method&&allowed(method)&&!!normalizedPhone&&!payment.busy;
 const presets=['10','100','250','500','1000','10000'].filter(value=>{try{return !!settings&&etbToCents(value)>=etbToCents(settings.minTopup)&&etbToCents(value)<=etbToCents(settings.maxTopup)}catch{return false}});
 const retry=async()=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order)||submitting.current)return;
  submitting.current=true;
  try{
   const current=await payment.check();if(!current||!bidPaymentCanRetry(current))return;
   const saved=queryIdentity?readPaymentRetryDraft(getMiniQueryClient(),queryIdentity,current.id):null;
   setAmount(current.amount);setMethod(current.paymentMethod??method);
   if(saved?.phone)setPhone(normalizePaymentPhone(saved.phone)?.slice(3)??'');
   payment.startAgain();methods.reload();availability.reload();
  }finally{submitting.current=false}
 };
 const pay=async()=>{if(!authenticated){openRegistration();return}if(!ready||!normalizedPhone||submitting.current)return;submitting.current=true;try{await payment.createDirect({key:crypto.randomUUID(),purpose:'TOP_UP',amount:total,paymentMethod:method,phone:normalizedPhone})}finally{submitting.current=false}};
 const action=<button className={styles.pay} type="submit" form={id} data-payment-action disabled={authenticated?!ready:!amount}>{text(authenticated?`Top up ${formatEtb(total)}`:'Log in to top up',authenticated?`${formatEtb(total)} ያስገቡ`:'ገንዘብ ለማስገባት ይግቡ')}</button>;
 const contents=payment.started?<WalletTopUpProgress payment={payment} amount={initialChapaId&&!payment.order?null:total} provider={method} phone={phone} onRetry={()=>void retry()} onClose={onClose} footerPortal={!!onClose}/>:<form id={id} className={styles.topUp} data-wallet-top-up onSubmit={event=>{event.preventDefault();void pay()}}>
  <div className={styles.walletStrip}><span><Wallet size={16}/>{text('Available balance','ለመጠቀም ያለ ቀሪ ሂሳብ')}</span><strong data-wallet-top-up-balance>{walletDisplay(wallet.data?.available)??(authenticated?<span className={styles.placeholder} aria-label={text('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>:text('Log in','ይግቡ'))}</strong></div>
  <label className={styles.amountLabel} htmlFor={`${id}-amount`}>{text('Amount to top up','የሚያስገቡት መጠን')}</label><div className={styles.amountField}><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} aria-invalid={!!amount&&!!settings&&!valid||undefined} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value))setAmount(event.target.value)}}/><span>ETB</span></div>
  <div className={styles.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{presets.map(preset=><button key={preset} type="button" aria-pressed={amount===preset} onClick={()=>setAmount(preset)}>{Number(preset).toLocaleString('en-ET')}</button>)}</div>
  {amount&&settings&&!valid&&<p className={styles.error} role="alert">{text(`Enter ${settings.minTopup}–${settings.maxTopup} ETB.`,`${settings.minTopup}–${settings.maxTopup} ብር ያስገቡ።`)}</p>}
  <fieldset className={styles.methods} data-wallet-methods><legend>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={styles.methodGrid}>{enabledMethods.map(provider=><label className={styles.method} key={provider.slug} data-provider={provider.slug} data-selected={method===provider.slug} data-unavailable={!allowed(provider.slug)}><input type="radio" name={`${id}-method`} value={provider.slug} checked={method===provider.slug} disabled={!allowed(provider.slug)} onChange={()=>setMethod(provider.slug)} aria-label={provider.name}/><img src={provider.image} alt="" width={34} height={29}/><strong>{provider.name}</strong>{method===provider.slug&&<Check className={styles.methodCheck} size={16} strokeWidth={2.5} aria-hidden="true"/>}</label>)}</div></fieldset>
  {authenticated&&(!settings||!methods.data)&&!availability.error&&!methods.error&&<p className={styles.loading} role="status"><LoaderCircle className={styles.spin} size={17}/>{text('Loading payment methods…','የክፍያ መንገዶች በመጫን ላይ…')}</p>}
  {method&&<div className={styles.phone}><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div className={styles.phoneField}><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="off" maxLength={18} value={phone} onChange={event=>setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value)} placeholder="7•• / 9•• ••• •••" aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={`${id}-phone-help${phone&&phoneProblem?' '+id+'-phone-error':''}`}/></div><p className="sr-only" id={`${id}-phone-help`}>{text('Enter the phone registered with your selected payment method.','በመረጡት የክፍያ መንገድ የተመዘገበውን ስልክ ያስገቡ።')}</p>{phone&&phoneProblem&&<p className={styles.error} role="alert" id={`${id}-phone-error`} data-payment-phone-error>{paymentPhoneProblemMessage(phoneProblem,am)}</p>}</div>}
  {authenticated&&settings&&methods.data&&!enabledMethods.length&&!availability.error&&!methods.error&&<p className={styles.error} role="status">{text('Top-ups are currently unavailable.','ገንዘብ ማስገባት ለጊዜው አይገኝም።')}</p>}
  {method&&valid&&!allowed(method)&&<p className={styles.error} role="status">{text('This method is unavailable for this amount. Choose another method or amount.','ለዚህ መጠን ይህ መንገድ አይገኝም። ሌላ መንገድ ወይም መጠን ይምረጡ።')}</p>}
  {(methods.error||availability.error)&&<p className={styles.error} role="status">{text('Payment methods could not load.','የክፍያ መንገዶችን ማምጣት አልተቻለም።')} <button className={styles.retry} type="button" onClick={()=>{methods.reload();availability.reload()}}>{text('Retry','እንደገና')}</button></p>}
  {payment.error&&<p className={styles.error} role="alert">{payment.error}</p>}
  {wallet.error&&<p className={styles.error} role="status">{text(wallet.data?'Showing your saved balance.':'Balance is unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡ አይገኝም።')} <button type="button" className={styles.retry} onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  <p className={styles.hint}>{text('Your wallet updates after payment is verified.','ክፍያው ሲረጋገጥ ዋሌትዎ ይዘምናል።')}{settings?.mode==='test'&&<> {text('Test mode · no real money.','የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።')}</>}</p>
  {onClose?<AccountSheetFooter>{action}</AccountSheetFooter>:action}
 </form>;
 const title=<span className={styles.title}><Wallet size={19}/>{text('Top up wallet','ገንዘብ ያስገቡ')}</span>;
 return embedded?contents:onClose?<AccountSheet size="payment" title={payment.started?text('Payment','ክፍያ'):title} presentation={payment.started?'centered':undefined} onClose={onClose} returnFocusRef={returnFocusRef} footerPortal>{contents}</AccountSheet>:<section className={styles.page}><h1>{title}</h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={`${queryIdentity??'guest'}:${props.initialChapaId??''}`} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
