'use client';
import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {ArrowRight,LoaderCircle,ShieldCheck,Wallet} from 'lucide-react';
import {AccountSheet,AccountSheetFooter} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {useChapaPayment} from './chapa-payment';
import {WalletTopUpProgress} from './wallet-top-up-progress';
import PaymentMethodForm from './payment-method-form';
import {usePaymentCheckoutFlow} from './payment-checkout-flow';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {normalizePaymentPhone,type DirectPaymentMethods} from '@/lib/bid-batch-client';
import {paymentPhoneProblem} from '@/lib/payment-phone';
import type {ChapaAvailability} from '@/lib/chapa-client';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {getMiniQueryClient} from './private-query-cache';
import {readPaymentRetryDraft} from '@/lib/payment-retry-draft';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './wallet-sheet.module.css';

const supported=new Set(['telebirr','cbebirr','mpesa']);
export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}

type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>;initialChapaId?:string;retryDraft?:{amount:string;paymentMethod:string;phone:string};embedded?:boolean;onProgressChange?:(active:boolean)=>void;onDismissChange?:(back:(()=>void)|null)=>void};
function TopUp({onClose,returnFocusRef,initialChapaId,retryDraft,embedded=false,onProgressChange,onDismissChange}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,openRegistration}=useTelegram(),authenticated=!!queryIdentity;
 const payment=useChapaPayment('topup',initialChapaId,{retainOriginal:true}),original=payment.directAttempt?.purpose==='TOP_UP'?payment.directAttempt:null,flow=usePaymentCheckoutFlow();
 const [amount,setAmount]=useState(()=>original?.amount??retryDraft?.amount??'100'),[method,setMethod]=useState(()=>original?.paymentMethod??retryDraft?.paymentMethod??''),[phone,setPhone]=useState(()=>normalizePaymentPhone(original?.phone??retryDraft?.phone??'')?.slice(3)??''),id=useId(),submitting=useRef(false),phoneEdited=useRef(!!original?.phone||!!retryDraft?.phone);
 useEffect(()=>{onProgressChange?.(payment.started);return()=>onProgressChange?.(false)},[payment.started,onProgressChange]);
 useEffect(()=>{onDismissChange?.(!payment.started&&flow.step==='payment'?flow.editDraft:null);return()=>onDismissChange?.(null)},[payment.started,flow.step,flow.editDraft,onDismissChange]);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:authenticated,freshnessMs:15000});
 const availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{enabled:authenticated&&!payment.started,freshnessMs:15000});
 const methods=usePrivateQuery<DirectPaymentMethods>('/api/payments/chapa/methods',{enabled:authenticated&&!payment.started,freshnessMs:60000}),settings=availability.data;
 useEffect(()=>{if(phoneEdited.current)return;const registered=normalizePaymentPhone(methods.data?.paymentPhone??'');if(registered)setPhone(registered.slice(3))},[methods.data?.paymentPhone]);
 let cents=0n,total='0.00',valid=false;
 try{cents=etbToCents(amount);total=centsToEtb(cents);valid=!!settings&&/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amount)&&cents>=etbToCents(settings.minTopup)&&cents<=etbToCents(settings.maxTopup)}catch{}
 const enabledMethods=settings?.enabled?(methods.data?.methods??[]).filter(item=>supported.has(item.slug)):[];
 const allowed=(slug:string)=>{const item=enabledMethods.find(item=>item.slug===slug);return !!item&&valid&&(!item.minAmountCents||cents>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||cents<=BigInt(item.maxAmountCents))};
 const phoneProblem=paymentPhoneProblem(phone,method),normalizedPhone=phoneProblem?null:normalizePaymentPhone(phone);
 const ready=flow.step==='payment'&&valid&&!!settings?.enabled&&!!method&&allowed(method)&&!!normalizedPhone&&!payment.busy;
 const presets=['10','100','250','500','1000','10000'].filter(value=>{try{return !!settings&&etbToCents(value)>=etbToCents(settings.minTopup)&&etbToCents(value)<=etbToCents(settings.maxTopup)}catch{return false}});
 const retry=async()=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order)||submitting.current)return;
  submitting.current=true;
  try{
   const current=await payment.check();if(!current||!bidPaymentCanRetry(current))return;
   const saved=queryIdentity?readPaymentRetryDraft(getMiniQueryClient(),queryIdentity,current.id):null;
   setAmount(current.amount);setMethod(current.paymentMethod??method);
   if(saved?.phone){phoneEdited.current=true;setPhone(normalizePaymentPhone(saved.phone)?.slice(3)??'')}
   payment.startAgain();flow.retryDraft();methods.reload();availability.reload();
  }finally{submitting.current=false}
 };
 const pay=async()=>{if(!authenticated){openRegistration();return}if(!ready||!normalizedPhone||submitting.current)return;submitting.current=true;try{await payment.createDirect({key:crypto.randomUUID(),purpose:'TOP_UP',amount:total,paymentMethod:method,phone:normalizedPhone})}finally{submitting.current=false}};
 const next=()=>{if(!authenticated){openRegistration();return}if(valid&&!payment.busy)flow.continueToPayment()};
 const continueAction=<button className={`${styles.pay} ${styles.topUpPay}`} type="submit" form={id} data-top-up-continue disabled={authenticated?!valid:!amount}>{text(authenticated?'Continue to payment':'Log in to top up',authenticated?'ወደ ክፍያ ቀጥል':'ገንዘብ ለማስገባት ይግቡ')}<ArrowRight size={17} aria-hidden="true"/></button>;
 const contents=payment.started?<WalletTopUpProgress payment={payment} amount={initialChapaId&&!payment.order?null:total} provider={method} phone={phone} onRetry={()=>void retry()} onClose={onClose} footerPortal={!!onClose}/>:<div data-wallet-top-up data-top-up-step={flow.step}>
  {flow.step==='entry'?<form id={id} className={styles.topUp} onSubmit={event=>{event.preventDefault();next()}}>
   <div className={styles.walletStrip}><span><Wallet size={16}/>{text('Available balance','ለመጠቀም ያለ ቀሪ ሂሳብ')}</span><strong data-wallet-top-up-balance>{walletDisplay(wallet.data?.available)??(authenticated?<span className={styles.placeholder} aria-label={text('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>:text('Log in','ይግቡ'))}</strong></div>
   <label className={styles.amountLabel} htmlFor={`${id}-amount`}>{text('Amount to top up','የሚያስገቡት መጠን')}</label><div className={styles.amountField}><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} aria-invalid={!!amount&&!!settings&&!valid||undefined} aria-describedby={amount&&settings&&!valid?`${id}-amount-error`:undefined} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value))setAmount(event.target.value)}}/><span>ETB</span></div>
   <div className={styles.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{presets.map(preset=><button key={preset} type="button" aria-pressed={amount===preset} onClick={()=>setAmount(preset)}>{Number(preset).toLocaleString('en-ET')}</button>)}</div>
   {amount&&settings&&!valid&&<p className={styles.error} role="alert" id={`${id}-amount-error`}>{text(`Enter ${settings.minTopup}–${settings.maxTopup} ETB.`,`${settings.minTopup}–${settings.maxTopup} ብር ያስገቡ።`)}</p>}
   {authenticated&&!settings&&!availability.error&&<p className={styles.loading} role="status"><LoaderCircle className={styles.spin} size={17}/>{text('Loading top-up limits…','የገንዘብ ማስገቢያ ገደቦች በመጫን ላይ…')}</p>}
   {availability.error&&<p className={styles.error} role="status">{text('Top-up settings could not load.','የገንዘብ ማስገቢያ ቅንብሮችን ማምጣት አልተቻለም።')} <button className={styles.retry} type="button" onClick={availability.reload}>{text('Retry','እንደገና')}</button></p>}
   {wallet.error&&<p className={styles.error} role="status">{text(wallet.data?'Showing your saved balance.':'Balance is unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡ አይገኝም።')} <button type="button" className={styles.retry} onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
   <p className={styles.topUpNote}><ShieldCheck size={15} aria-hidden="true"/><span>{text('Your wallet updates after payment is verified.','ክፍያው ሲረጋገጥ ዋሌትዎ ይዘምናል።')}{settings?.mode==='test'&&<> {text('Test mode · no real money.','የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።')}</>}</span></p>
   {onClose?<AccountSheetFooter>{continueAction}</AccountSheetFooter>:continueAction}
  </form>:<PaymentMethodForm total={total} method={method} phone={phone} onMethodChange={setMethod} onPhoneChange={value=>{phoneEdited.current=true;setPhone(value)}} methods={enabledMethods} busy={payment.busy} payDisabled={!ready} payLabel={text(`Pay ${formatEtb(total)}`,`${formatEtb(total)} ይክፈሉ`)} onPay={()=>void pay()} onBack={flow.editDraft} summary={<><strong>{text('Wallet top-up','የዋሌት ገቢ')}</strong> · {formatEtb(total)}</>} error={payment.error} methodsLoading={!methods.data&&!methods.error} methodsError={!!methods.error||!!availability.error} onReloadMethods={()=>{methods.reload();availability.reload()}} footerPortal={!!onClose}/>}
 </div>;
 const title=<span className={`${styles.title} ${styles.topUpTitle}`}><Wallet size={19} aria-hidden="true"/>{text('Top up wallet','ገንዘብ ያስገቡ')}</span>;
 return embedded?contents:onClose?<AccountSheet size="payment" title={payment.started||flow.step==='payment'?text('Payment','ክፍያ'):title} presentation={payment.started?'centered':undefined} onClose={onClose} onBack={!payment.started&&flow.step==='payment'?flow.editDraft:undefined} returnFocusRef={returnFocusRef} footerPortal>{contents}</AccountSheet>:<section className={styles.page}><h1>{title}</h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={`${queryIdentity??'guest'}:${props.initialChapaId??''}`} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
