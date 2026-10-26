'use client';
import {useId,useState,type RefObject} from 'react';
import {CreditCard,Info,Wallet} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {IdentityState} from './identity-state';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {ChapaAvailability} from '@/lib/chapa-client';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './bid-payment-sheet.module.css';

export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}
type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>};
function TopUp({onClose,returnFocusRef}:Props){
 const {language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en,{queryIdentity}=useTelegram();
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000}),availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000});
 const payment=useChapaPayment('topup'),[amount,setAmount]=useState(''),id=useId(),settings=availability.data,authenticated=wallet.status==='authenticated';
 let valid=false;try{const value=etbToCents(amount);valid=/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amount)&&value>=etbToCents(settings?.minTopup??'1')&&value<=etbToCents(settings?.maxTopup??'43200')}catch{}
 const action=!payment.started&&authenticated?<button type="submit" form={id} className={styles.payButton} data-payment-action disabled={!valid||!settings?.enabled||payment.busy}>{text(payment.busy?'Preparing checkout…':'Top up',payment.busy?'የክፍያ ገጹን በማዘጋጀት ላይ…':'ገንዘብ ያስገቡ')}</button>:undefined;
 const contents=payment.started?<ChapaPaymentStatus payment={payment}/>:<>{!authenticated&&wallet.status!=='loading'?<IdentityState compact/>:<form id={id} className={styles.topUp} onSubmit={event=>{event.preventDefault();if(valid&&settings?.enabled&&queryIdentity&&!payment.busy)void payment.create({purpose:'TOP_UP',amount,key:crypto.randomUUID()})}}>
  <div className={styles.walletStrip}><span><Wallet size={15} aria-hidden="true"/>{text('Wallet','ዋሌት')}</span><strong>{walletDisplay(wallet.data?.available)??(wallet.error?'— ETB':<span className={styles.fieldSkeleton} aria-label={text('Loading wallet balance','የዋሌት ቀሪ ሂሳብ በመጫን ላይ')}/>)}</strong></div>
  <p className={styles.hint}><Info size={14} aria-hidden="true"/>{text('Your available balance can pay auction submission fees.','ያለዎትን ቀሪ ሂሳብ ለጨረታ ማስገቢያ ክፍያ መጠቀም ይችላሉ።')}</p>
  <label className={styles.inputLabel} htmlFor={`${id}-amount`}>{text('Amount','መጠን')}</label><div className={styles.amountInput}><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} disabled={payment.busy} onChange={event=>setAmount(event.target.value)} placeholder="0.00" aria-describedby={`${id}-notice`}/><span>ETB</span></div>
  <div className={styles.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{['100','250','500','1000'].map(value=><button key={value} type="button" aria-pressed={amount===value} disabled={payment.busy} onClick={()=>setAmount(value)}>{Number(value).toLocaleString('en-ET',{minimumFractionDigits:2})} ETB</button>)}</div>
  {amount&&!valid&&<p className={styles.error}>{text(`Enter ${settings?.minTopup??'1.00'}–${settings?.maxTopup??'43,200.00'} ETB, with up to two decimal places.`,`${settings?.minTopup??'1.00'}–${settings?.maxTopup??'43,200.00'} ብር፣ እስከ ሁለት የአስርዮሽ ቦታዎች ያስገቡ።`)}</p>}
  <fieldset className={styles.methods}><legend><CreditCard size={14} aria-hidden="true"/>{text('Payment method','የክፍያ መንገድ')}</legend><label className={`${styles.method} ${styles.selected}`}><span className={styles.methodIcon}><CreditCard size={20} aria-hidden="true"/></span><span className={styles.methodText}><strong>Chapa</strong><small>{text('Continue to Chapa checkout','ወደ Chapa ክፍያ ይቀጥሉ')}</small></span><input type="radio" name={`${id}-provider`} value="chapa" checked readOnly aria-label="Chapa"/></label></fieldset>
  <p id={`${id}-notice`} className={styles.availability} role="status">{settings?.enabled?text(settings.mode==='test'?'Test checkout · no real money.':'Your wallet is credited only after secure payment verification.',settings.mode==='test'?'የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።':'ክፍያው በደህንነት ከተረጋገጠ በኋላ ብቻ ወደ ዋሌትዎ ይጨመራል።'):text('Top-ups are not available yet.','ገንዘብ ማስገባት ገና አልተጀመረም።')}</p>
  {(availability.error||wallet.error)&&<p className={styles.error} role="status">{text('Payment details could not refresh.','የክፍያ ዝርዝሮችን ማደስ አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={()=>{availability.reload();wallet.reload()}}>{text('Retry','እንደገና')}</button></p>}{payment.error&&<p className={styles.error} role="alert">{payment.error}</p>}
  {!onClose&&action}
 </form>}</>;
 return onClose?<AccountSheet size="payment" title={<MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/>} onClose={onClose} returnFocusRef={returnFocusRef} footer={action}>{contents}</AccountSheet>:<section className={styles.page}><h1><MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/></h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
