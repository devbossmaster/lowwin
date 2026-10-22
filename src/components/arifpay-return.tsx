'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';
import {LoadingSpinner} from './loading-spinner';
import {requestArifPayJson} from '@/lib/arifpay-recovery';
import type {ArifPayCheckoutView} from '@/modules/payments/arifpay';
const Checkout=dynamic(()=>import('./arifpay-checkout'));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const accepted=()=>{};
export function ArifPayReturn({auctionSlug}:{auctionSlug:string}){
 const {queryIdentity}=useTelegram();return <ReturnForIdentity key={queryIdentity??'guest'} auctionSlug={auctionSlug}/>;
}
function ReturnForIdentity({auctionSlug}:{auctionSlug:string}){
 const {queryIdentity}=useTelegram(),[id,setId]=useState<string|null>(null),[order,setOrder]=useState<ArifPayCheckoutView|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const value=new URL(window.location.href).searchParams.get('checkout');if(value&&uuid.test(value))setId(value)},[]);
 useEffect(()=>{
  if(!queryIdentity||!id)return;let disposed=false;const controller=new AbortController();setError(false);
  void requestArifPayJson<ArifPayCheckoutView>(`/api/payments/arifpay/checkouts/${id}`,{},controller.signal).then(value=>{if(!disposed){if(value.auctionSlug!==auctionSlug)throw Error('Wrong auction');setOrder(value)}}).catch(()=>{if(!disposed)setError(true)});
  return()=>{disposed=true;controller.abort()};
 },[queryIdentity,id,auctionSlug,retry]);
 if(!id||!queryIdentity)return null;
 if(order)return <Checkout slug={order.auctionSlug} amount={order.amount} fee={order.fee} feeVersion={order.feeVersion} initialOrder={order} onAccepted={accepted}/>;
 return <section className="arif-checkout" aria-live="polite"><h3><MiniPhrase en="Your payment" am="የእርስዎ ክፍያ"/></h3>{error?<><p role="alert"><MiniPhrase en="Your payment could not load. Keep this ID and check your history before paying again." am="ክፍያዎን መጫን አልተቻለም። እንደገና ከመክፈልዎ በፊት ታሪክዎን ይፈትሹ።"/></p><small style={{overflowWrap:'anywhere'}}>{id}</small><button className="secondary-button" onClick={()=>setRetry(value=>value+1)}><MiniPhrase en="Retry" am="እንደገና"/></button><Link href="/wallet"><MiniPhrase en="Payment history" am="የክፍያ ታሪክ"/></Link></>:<LoadingSpinner/>}</section>;
}
