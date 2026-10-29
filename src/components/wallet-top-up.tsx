'use client';
import {useId,useState,type RefObject} from 'react';
import Link from 'next/link';
import {Wallet} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {IdentityState} from './identity-state';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import {ChapaLogo} from './chapa-logo';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {ChapaAvailability} from '@/lib/chapa-client';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './bid-payment-sheet.module.css';

export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}

type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>;initialChapaId?:string};
function TopUp({onClose,returnFocusRef,initialChapaId}:Props){
 const {language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en,{queryIdentity}=useTelegram();
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000}),availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000});
 const payment=useChapaPayment('topup',initialChapaId),[amount,setAmount]=useState('100'),id=useId(),settings=availability.data;
 const frozen=payment.attempt?.intent.purpose==='TOP_UP'?payment.attempt.intent.amount:null,value=frozen??amount;
 let valid=false,total='';try{const cents=etbToCents(value);valid=/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)&&cents>=etbToCents(settings?.minTopup??'1')&&cents<=etbToCents(settings?.maxTopup??'43200');total=centsToEtb(cents)}catch{}
 const showStatus=payment.started;
 const action=!showStatus?<button type="submit" form={id} className={styles.payButton} data-payment-action disabled={!queryIdentity||!valid||!settings?.enabled||payment.busy||payment.restoring}>{payment.busy?text('Opening Chapa…','Chapa በመክፈት ላይ…'):text(`Pay${valid?' '+total+' ETB':''}`,`${valid?total+' ብር ':''}ክፈሉ`)}</button>:undefined;
 const contents=showStatus?<ChapaPaymentStatus payment={payment} onNavigate={onClose}/>:!queryIdentity&&wallet.status!=='loading'?<IdentityState compact/>:<form id={id} className={`${styles.topUp} ${styles.simpleTopUp}`} onSubmit={event=>{event.preventDefault();if(valid&&settings?.enabled&&queryIdentity&&!payment.busy)void payment.create({purpose:'TOP_UP',amount:value,key:crypto.randomUUID()})}}>
  <div className={styles.walletStrip}><span><Wallet size={15} aria-hidden="true"/>{text('Wallet','ዋሌት')}</span><strong>{walletDisplay(wallet.data?.available)??<span className={styles.fieldSkeleton} aria-label={text('Loading wallet balance','የዋሌት ቀሪ ሂሳብ በመጫን ላይ')}/>}</strong></div>
  <label className={styles.inputLabel} htmlFor={`${id}-amount`}>{text('Amount','መጠን')}</label><div className={styles.amountInput}><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" maxLength={19} value={value} disabled={payment.busy||!!frozen} onChange={event=>setAmount(event.target.value)} aria-describedby={`${id}-notice`}/><span>ETB</span></div>
  <div className={styles.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{['100','250','500','1000'].map(preset=><button key={preset} type="button" aria-pressed={value===preset} disabled={payment.busy||!!frozen} onClick={()=>setAmount(preset)}>{Number(preset).toLocaleString('en-ET')}</button>)}</div>
  {value&&!valid&&<p className={styles.error}>{text(`Enter ${settings?.minTopup??'1.00'}–${settings?.maxTopup??'43,200.00'} ETB.`,`${settings?.minTopup??'1.00'}–${settings?.maxTopup??'43,200.00'} ብር ያስገቡ።`)}</p>}
  <label className={`${styles.method} ${styles.selected}`}><span className={styles.providerLogo}><ChapaLogo/></span><span className={styles.methodText}><strong>Chapa</strong></span><input type="radio" name={`${id}-provider`} value="chapa" checked readOnly aria-label="Chapa"/></label>
  <p id={`${id}-notice`} className={styles.availability} role="status">{settings?.enabled?text(settings.mode==='test'?'Test mode · no real money.':'Enter your payment details on Chapa.',settings.mode==='test'?'የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።':'የክፍያ መረጃዎን በChapa ያስገቡ።'):availability.error?text('Could not load Chapa.','Chapa መጫን አልተቻለም።'):settings?text('Chapa is unavailable.','Chapa አልተገኘም።'):text('Loading Chapa…','Chapa በመጫን ላይ…')}</p>
  {availability.error&&<button className={styles.inlineRetry} type="button" onClick={availability.reload}>{text('Retry','እንደገና')}</button>}
  {payment.error&&<p className={styles.error} role="alert">{payment.error}</p>}
  {payment.order&&!payment.order.checkoutUrl&&!payment.error&&<p className={styles.error} role="status">{text('Chapa could not open. Try Pay again.','Chapa መክፈት አልተቻለም። እንደገና ክፈሉን ይጫኑ።')}</p>}
  <div className={styles.links}><Link href="/payments" prefetch={false} onClick={onClose}>{text('Payment history','የክፍያ ታሪክ')}</Link></div>
  {!onClose&&action}
 </form>;
 return onClose?<AccountSheet size="payment" title={<MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/>} onClose={onClose} returnFocusRef={returnFocusRef} footer={action}>{contents}</AccountSheet>:<section className={styles.page}><h1><MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/></h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={`${queryIdentity??'guest'}:${props.initialChapaId??''}`} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
