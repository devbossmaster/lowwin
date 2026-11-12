'use client';
import {Ticket} from 'lucide-react';
import type {OwnCouponCount} from '@/modules/referrals/coupon-count';
import {usePrivateQuery} from './private-query';
import {useMiniLocale} from './mini-locale';
import styles from './reference-bid-checkout.module.css';

export function BidCouponControl({applyCoupon,disabled,onChange}:{applyCoupon:boolean;disabled:boolean;onChange:(value:boolean)=>void}){
 const {language}=useMiniLocale(),am=language==='am';
 const count=usePrivateQuery<OwnCouponCount>('/api/referrals/coupon-count',{freshnessMs:30000});
 if(count.status!=='authenticated'||count.data?.configured===false)return null;
 const available=count.data?.available??null,loading=available===null&&!count.error;
 return <div className={styles.coupons} data-bid-coupons data-applied={applyCoupon} aria-busy={loading}>
  <Ticket size={14} aria-hidden="true"/>
  <span>{am?'ኩፖኖች':'Coupons'} <b aria-label={available===null?(count.error?(am?'የኩፖን ብዛት ለጊዜው አይገኝም':'Coupon count unavailable'):(am?'የኩፖን ብዛት በመጫን ላይ':'Loading coupon count')):undefined}>{available??'—'}</b></span>
  {count.error&&available===null?<button type="button" disabled={disabled||count.fetching} onClick={count.reload}>{am?'እንደገና':'Retry'}</button>:<button type="button" aria-pressed={applyCoupon} disabled={disabled||!applyCoupon&&(!available||!!count.error)} onClick={()=>onChange(!applyCoupon)}>{am?(applyCoupon?'አስወግድ':'ተጠቀም'):(applyCoupon?'Remove':'Apply')}</button>}
 </div>;
}
