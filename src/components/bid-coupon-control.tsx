'use client';
import {Ticket} from 'lucide-react';
import {useId} from 'react';
import type {OwnCouponCount} from '@/modules/referrals/coupon-count';
import {usePrivateQuery} from './private-query';
import {useMiniLocale} from './mini-locale';
import styles from './reference-bid-checkout.module.css';

export function BidCouponControl({applyCoupon,disabled,onChange}:{applyCoupon:boolean;disabled:boolean;onChange:(value:boolean)=>void}){
 const {language}=useMiniLocale(),am=language==='am',promptId=useId();
 const count=usePrivateQuery<OwnCouponCount>('/api/referrals/coupon-count',{freshnessMs:30000});
 if(count.status!=='authenticated'||count.data?.configured===false)return null;
 const available=count.data?.available??null,loading=available===null&&!count.error;
 const canApply=available!==null&&available>0&&!count.error;
 const showOffer=canApply&&!applyCoupon&&!disabled;
 return <div className={styles.coupons} data-bid-coupons data-applied={applyCoupon} data-coupon-available={showOffer||undefined} aria-busy={loading}>
  <Ticket size={14} aria-hidden="true"/>
  <span className={styles.couponCopy}>
   <span className={styles.couponCount}>{am?'ኩፖኖች':'Coupons'} <b aria-label={available===null?(count.error?(am?'የኩፖን ብዛት ለጊዜው አይገኝም':'Coupon count unavailable'):(am?'የኩፖን ብዛት በመጫን ላይ':'Loading coupon count')):undefined}>{available??'—'}</b></span>
   {showOffer&&<small className={styles.couponPrompt} id={promptId}>{am?'በአንድ የጨረታ ክፍያ ቅናሽ ያግኙ':'Save on one bid fee'}</small>}
  </span>
  {count.error&&available===null?<button type="button" disabled={disabled||count.fetching} onClick={count.reload}>{am?'እንደገና':'Retry'}</button>:<button type="button" aria-pressed={applyCoupon} aria-describedby={showOffer?promptId:undefined} disabled={disabled||!applyCoupon&&!canApply} onClick={()=>onChange(!applyCoupon)}>{am?(applyCoupon?'አስወግድ':'ተጠቀም'):(applyCoupon?'Remove':'Apply')}</button>}
 </div>;
}
