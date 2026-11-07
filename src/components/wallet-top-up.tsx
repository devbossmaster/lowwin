'use client';
import {useId,useState,type RefObject} from 'react';
import dynamic from 'next/dynamic';
import {ArrowLeft,Wallet} from 'lucide-react';
import {AccountSheet,AccountSheetFooter} from './account-sheet';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {ChapaAvailability} from '@/lib/chapa-client';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './bid-payment-sheet.module.css';
import ui from './batch-checkout.module.css';
const DirectCheckout=dynamic(()=>import('./direct-checkout'),{ssr:false});
export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}
type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>;initialChapaId?:string};
function TopUp({onClose,returnFocusRef,initialChapaId}:Props){
 const {language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en,{queryIdentity,openRegistration}=useTelegram();
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000}),availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000});
 const payment=useChapaPayment('topup',initialChapaId),[amount,setAmount]=useState('100'),[checkout,setCheckout]=useState(false),id=useId(),settings=availability.data;
 let valid=false,total='0.00';try{const cents=etbToCents(amount);valid=/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amount)&&cents>=etbToCents(settings?.minTopup??'1')&&cents<=etbToCents(settings?.maxTopup??'43200');total=centsToEtb(cents)}catch{}
 const action=<button className={styles.payButton} data-payment-action type="submit" form={id} disabled={!valid||!!queryIdentity&&!settings?.enabled}>{text(queryIdentity?'Continue to payment':'Log in to top up',queryIdentity?'ወደ ክፍያ ይቀጥሉ':'ገንዘብ ለማስገባት ይግቡ')}</button>;
 const contents=initialChapaId&&(!payment.order||payment.order.chargeType!=='DIRECT')?<ChapaPaymentStatus payment={payment} onNavigate={onClose}/>:checkout||payment.started?<DirectCheckout payment={payment} purpose="TOP_UP" amount={payment.order?.amount??total} onClose={onClose} onBack={()=>setCheckout(false)}/>:<form id={id} className={`${styles.topUp} ${styles.simpleTopUp}`} onSubmit={event=>{event.preventDefault();if(!queryIdentity){openRegistration();return}if(valid&&settings?.enabled)setCheckout(true)}}>
  <div className={styles.walletStrip}><span><Wallet size={15}/>{text('Wallet','ዋሌት')}</span><strong>{queryIdentity?walletDisplay(wallet.data?.available)??'—':text('Log in','ይግቡ')}</strong></div>
  {wallet.error&&<p className={styles.error} role="status">{text(wallet.data?'Showing the saved balance. Refresh failed.':'Balance is unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል። ማደስ አልተሳካም።':'ቀሪ ሂሳቡ አይገኝም።')} <button className={styles.inlineRetry} type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  <label className={styles.inputLabel} htmlFor={`${id}-amount`}>{text('Amount','መጠን')}</label><div className={styles.amountInput}><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value))setAmount(event.target.value)}}/><span>ETB</span></div>
  <div className={styles.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{['100','250','500','1000'].map(preset=><button key={preset} type="button" aria-pressed={amount===preset} onClick={()=>setAmount(preset)}>{Number(preset).toLocaleString('en-ET')}</button>)}</div>
  {amount&&!valid&&<p className={styles.error}>{text(`Enter ${settings?.minTopup??'1.00'}–${settings?.maxTopup??'43,200.00'} ETB.`,`${settings?.minTopup??'1.00'}–${settings?.maxTopup??'43,200.00'} ብር ያስገቡ።`)}</p>}
  <p className={ui.note}>{text('Choose your payment method and phone number next. The wallet updates only after payment is verified.','ቀጥሎ የክፍያ መንገድና ስልክ ቁጥር ይምረጡ። ዋሌቱ የሚዘምነው ክፍያው ሲረጋገጥ ብቻ ነው።')}</p>
  {settings?.mode==='test'&&<p className={ui.note}>{text('Test mode · no real money.','የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።')}</p>}
  {availability.error&&<p className={styles.error}>{text('Payment options could not load.','የክፍያ አማራጮችን መጫን አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={availability.reload}>{text('Retry','እንደገና')}</button></p>}
  {queryIdentity&&settings&&!settings.enabled&&<p className={styles.error}>{text('Online payments are unavailable.','የመስመር ላይ ክፍያ አይገኝም።')}</p>}
  {onClose?<AccountSheetFooter>{action}</AccountSheetFooter>:action}
 </form>;
 return onClose?<AccountSheet size="payment" layout={checkout||payment.order?.chargeType==='DIRECT'?'checkout':undefined} title={<MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/>} onClose={onClose} returnFocusRef={returnFocusRef} footerPortal>{contents}</AccountSheet>:<section className={styles.page}><h1><MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/></h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={`${queryIdentity??'guest'}:${props.initialChapaId??''}`} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
