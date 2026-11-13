'use client';
import {Gift} from 'lucide-react';
import {depositBonusPreview,type DepositBonusOffer} from '@/lib/deposit-bonus-preview';
import {useMiniLocale} from './mini-locale';
import styles from './deposit-bonus-card.module.css';

export function DepositBonusCard({policy,amount,compact=false}:{policy:DepositBonusOffer|null|undefined;amount?:string;compact?:boolean}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const preview=depositBonusPreview(amount??'0',policy);
 if(!policy||!preview.active)return null;
 return <aside className={styles.offer} data-deposit-bonus-offer data-compact={compact||undefined}>
  <span className={styles.icon} aria-hidden="true"><Gift size={compact?20:25} strokeWidth={1.7}/></span>
  <div className={styles.content}>
   <h3>{text('Deposit bonus','የገቢ ቦነስ')} <strong>+{policy.percent}%</strong></h3>
   <p>{text(`Add ${policy.minAmount} ETB or more and receive ${policy.percent}% extra for bid fees.`,`ከ ${policy.minAmount} ብር ጀምሮ ያስገቡና ${policy.percent}% ተጨማሪ ለጨረታ ክፍያ ያግኙ።`)} {text(`Bonus expires ${policy.validityDays} days after credit.`,`ቦነሱ ከገባ ከ${policy.validityDays} ቀናት በኋላ ያበቃል።`)}</p>
   {policy.maxBonus&&<small>{text(`Up to ${policy.maxBonus} ETB bonus per deposit.`,`በእያንዳንዱ ገቢ እስከ ${policy.maxBonus} ብር ቦነስ።`)}</small>}
   {amount&&<div className={styles.preview} aria-live="polite"><span>{text('Bonus','ቦነስ')}</span><strong>+{preview.bonusAmount} ETB</strong></div>}
  </div>
 </aside>;
}
