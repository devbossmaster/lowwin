'use client';
import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {ArrowUpRight,LoaderCircle,ShieldCheck,Wallet} from 'lucide-react';
import {AccountSheet,AccountSheetFooter} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {useChapaPayment} from './chapa-payment';
import {HostedCheckoutStatus} from './hosted-checkout-status';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {ChapaAvailability} from '@/lib/chapa-client';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './wallet-sheet.module.css';

export function walletDisplay(value?:string){try{return value===undefined?null:centsToEtb(etbToCents(value))+' ETB'}catch{return null}}
type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>;initialChapaId?:string;retryDraft?:{amount:string;paymentMethod:string;phone:string};embedded?:boolean;onProgressChange?:(active:boolean)=>void;onDismissChange?:(back:(()=>void)|null)=>void};
function TopUp({onClose,returnFocusRef,initialChapaId,retryDraft,embedded=false,onProgressChange,onDismissChange}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,openRegistration}=useTelegram(),authenticated=!!queryIdentity;
 const payment=useChapaPayment('topup',initialChapaId,{retainOriginal:true});
 const restored=payment.attempt?.intent.purpose==='TOP_UP'?payment.attempt.intent.amount:undefined;
 const [amount,setAmount]=useState(()=>restored??retryDraft?.amount??'100'),id=useId(),submitting=useRef(false);
 useEffect(()=>{onProgressChange?.(payment.started);return()=>onProgressChange?.(false)},[payment.started,onProgressChange]);
 useEffect(()=>{onDismissChange?.(null);return()=>onDismissChange?.(null)},[onDismissChange]);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:authenticated,freshnessMs:15000});
 const availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{enabled:authenticated&&!payment.started,freshnessMs:15000}),settings=availability.data;
 let total='0.00',valid=false;
 try{const cents=etbToCents(amount);total=centsToEtb(cents);valid=!!settings&&/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amount)&&cents>=etbToCents(settings.minTopup)&&cents<=etbToCents(settings.maxTopup)}catch{}
 const ready=valid&&!!settings?.enabled&&!payment.busy;
 const presets=['10','100','250','500','1000','10000'].filter(value=>{try{return !!settings&&etbToCents(value)>=etbToCents(settings.minTopup)&&etbToCents(value)<=etbToCents(settings.maxTopup)}catch{return false}});
 const pay=async()=>{
  if(!authenticated){openRegistration();return}
  if(!ready||submitting.current)return;
  submitting.current=true;
  try{await payment.create({key:crypto.randomUUID(),purpose:'TOP_UP',amount:total})}finally{submitting.current=false}
 };
 const retry=async()=>{
  if(!payment.canStartAgain||submitting.current)return;
  if(payment.order?.status==='CREDITED'){setAmount(payment.order.amount);payment.startAgain();availability.reload();return}
  submitting.current=true;
  try{const current=await payment.check();if(!current||!bidPaymentCanRetry(current))return;setAmount(current.amount);payment.startAgain();availability.reload()}finally{submitting.current=false}
 };
 const action=<button className={[styles.pay,styles.topUpPay].join(' ')} type="submit" form={id} data-top-up-continue disabled={authenticated?!ready:!amount}>{text(authenticated?'Continue to Chapa':'Log in to top up',authenticated?'ወደ Chapa ቀጥል':'ገንዘብ ለማስገባት ይግቡ')}<ArrowUpRight size={17} aria-hidden="true"/></button>;
 const contents=payment.started?<HostedCheckoutStatus payment={payment} onClose={onClose} onStartAgain={()=>void retry()}/>:<form id={id} className={styles.topUp} data-wallet-top-up data-top-up-step="entry" onSubmit={event=>{event.preventDefault();void pay()}}>
  <div className={styles.walletStrip}><span><Wallet size={16}/>{text('Available balance','ለመጠቀም ያለ ቀሪ ሂሳብ')}</span><strong data-wallet-top-up-balance>{walletDisplay(wallet.data?.available)??(authenticated?<span className={styles.placeholder} aria-label={text('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>:text('Log in','ይግቡ'))}</strong></div>
  <label className={styles.amountLabel} htmlFor={id+'-amount'}>{text('Amount to top up','የሚያስገቡት መጠን')}</label><div className={styles.amountField}><input id={id+'-amount'} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} aria-invalid={!!amount&&!!settings&&!valid||undefined} aria-describedby={amount&&settings&&!valid?id+'-amount-error':undefined} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value))setAmount(event.target.value)}}/><span>ETB</span></div>
  <div className={styles.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{presets.map(preset=><button key={preset} type="button" aria-pressed={amount===preset} onClick={()=>setAmount(preset)}>{Number(preset).toLocaleString('en-ET')}</button>)}</div>
  {amount&&settings&&!valid&&<p className={styles.error} role="alert" id={id+'-amount-error'}>{text('Enter '+settings.minTopup+'–'+settings.maxTopup+' ETB.',settings.minTopup+'–'+settings.maxTopup+' ብር ያስገቡ።')}</p>}
  {authenticated&&!settings&&!availability.error&&<p className={styles.loading} role="status"><LoaderCircle className={styles.spin} size={17}/>{text('Loading top-up limits…','የገንዘብ ማስገቢያ ገደቦች በመጫን ላይ…')}</p>}
  {settings&&!settings.enabled&&<p className={styles.error} role="status">{text('Chapa top-ups are currently unavailable.','በChapa ገንዘብ ማስገባት ለጊዜው አይገኝም።')}</p>}
  {availability.error&&<p className={styles.error} role="status">{text('Top-up settings could not load.','የገንዘብ ማስገቢያ ቅንብሮችን ማምጣት አልተቻለም።')} <button className={styles.retry} type="button" onClick={availability.reload}>{text('Retry','እንደገና')}</button></p>}
  {wallet.error&&<p className={styles.error} role="status">{text(wallet.data?'Showing your saved balance.':'Balance is unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡን ማምጣት አልተቻለም።')} <button type="button" className={styles.retry} onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  {payment.error&&<p className={styles.error} role="alert">{payment.error}</p>}
  <p className={styles.topUpNote}><ShieldCheck size={15} aria-hidden="true"/><span>{text('Choose your payment method securely on Chapa. Your wallet updates after verification.','የክፍያ መንገድዎን በChapa ይምረጡ። ዋሌትዎ ክፍያው ከተረጋገጠ በኋላ ይዘምናል።')}{settings?.mode==='test'&&<> {text('Test mode · no real money.','የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።')}</>}</span></p>
  {onClose?<AccountSheetFooter>{action}</AccountSheetFooter>:action}
 </form>;
 const title=<span className={[styles.title,styles.topUpTitle].join(' ')}><Wallet size={19} aria-hidden="true"/>{text('Top up wallet','ገንዘብ ያስገቡ')}</span>;
 return embedded?contents:onClose?<AccountSheet size="payment" title={payment.started?text('Payment','ክፍያ'):title} onClose={onClose} returnFocusRef={returnFocusRef} footerPortal>{contents}</AccountSheet>:<section className={styles.page}><h1>{title}</h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={(queryIdentity??'guest')+':'+(props.initialChapaId??'')} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
