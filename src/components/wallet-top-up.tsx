'use client';
import {useId,useState,type RefObject} from 'react';
import {CreditCard,Info,Wallet} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {usePrivateQuery,PrivateState} from './private-query';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './bid-payment-sheet.module.css';

export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}
function TopUpFields({balance,showAction=true}:{balance:WalletBalance;showAction?:boolean}){
 const {language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en,[amount,setAmount]=useState(''),id=useId();
 let valid=false;try{valid=/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amount)&&etbToCents(amount)>0n}catch{}
 return <div className={styles.topUp}>
  <div className={styles.walletStrip}><span><Wallet size={15} aria-hidden="true"/>{text('Wallet','ዋሌት')}</span><strong>{walletDisplay(balance.available)??'— ETB'}</strong></div>
  <p className={styles.hint}><Info size={14} aria-hidden="true"/>{text('Your available balance can pay auction submission fees.','ያለዎትን ቀሪ ሂሳብ ለጨረታ ማስገቢያ ክፍያ መጠቀም ይችላሉ።')}</p>
  <label className={styles.inputLabel} htmlFor={id}>{text('Amount','መጠን')}</label><div className={styles.amountInput}><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} onChange={event=>setAmount(event.target.value)} placeholder="0.00" aria-describedby={`${id}-notice`}/><span>ETB</span></div>
  <div className={styles.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{['100','250','500','1000'].map(value=><button key={value} type="button" aria-pressed={amount===value} onClick={()=>setAmount(value)}>{Number(value).toLocaleString('en-ET',{minimumFractionDigits:2})} ETB</button>)}</div>
  {amount&&!valid&&<p className={styles.error}>{text('Enter a positive amount with up to two decimal places.','እስከ ሁለት የአስርዮሽ ቦታዎች ያለው ከዜሮ በላይ መጠን ያስገቡ።')}</p>}
  <fieldset className={styles.methods}><legend><CreditCard size={14} aria-hidden="true"/>{text('Payment method','የክፍያ መንገድ')}</legend><label className={`${styles.method} ${styles.selected}`}><span className={styles.methodIcon}><CreditCard size={20} aria-hidden="true"/></span><span className={styles.methodText}><strong>Chapa</strong><small>{text('Continue to Chapa checkout','ወደ Chapa ክፍያ ይቀጥሉ')}</small></span><input type="radio" name={`${id}-provider`} value="chapa" checked readOnly aria-label="Chapa"/></label></fieldset>
  <p id={`${id}-notice`} className={styles.availability} role="status">{text('Top-ups are not available yet.','ገንዘብ ማስገባት ገና አልተጀመረም።')}</p>
  {showAction&&<button type="button" className={styles.payButton} data-payment-action disabled>{text('Top up','ገንዘብ ያስገቡ')}</button>}
 </div>;
}
export default function WalletTopUpSheet({onClose,returnFocusRef}:{onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>}){
 const query=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 if(query.status==='loading'||query.status==='authenticated'&&!query.data&&!query.error)return null;
 return <AccountSheet size="payment" title={<MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/>} onClose={onClose} returnFocusRef={returnFocusRef} footer={query.data&&<button type="button" className={styles.payButton} data-payment-action disabled><MiniPhrase en="Top up" am="ገንዘብ ያስገቡ"/></button>}><PrivateState query={query}/>{query.data&&<TopUpFields balance={query.data} showAction={false}/>}</AccountSheet>;
}
export function WalletTopUpPage(){
 const query=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 return <section className={styles.page}><h1><MiniPhrase en="Top up wallet" am="ወደ ዋሌት ገንዘብ ያስገቡ"/></h1><PrivateState query={query}/>{query.data&&<TopUpFields balance={query.data}/>}</section>;
}
