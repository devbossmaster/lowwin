'use client';
import {useEffect} from 'react';
import type {BidBatchQuote} from '@/lib/bid-batch-client';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {chapaApiCharge,chapaCurrentInline,chapaConfirmed} from '@/lib/chapa-client';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import PaymentProgress from './payment-progress';

type Props={payment:ReturnType<typeof useChapaPayment>;purpose:'BID'|'TOP_UP';amount:string;batch?:BidBatchQuote;onClose?:()=>void;onStartAgain?:()=>void};

/** Restored payments reuse the shared status surface and the caller's owned
 * observer. This adapter cannot initialize a payment or create a new key. */
export default function DirectCheckout({payment,purpose,amount,batch,onClose,onStartAgain}:Props){
 const order=payment.order;
 useEffect(()=>{
  if(payment.started)payment.markPresented('feedback');
  if(order&&chapaApiCharge(order)&&order.authorizationReference)payment.markPresented('authorization');
  if(order&&chapaConfirmed(order))payment.markPresented('confirmed');
 },[payment.started,payment.markPresented,order]);
 if(order&&!order.unsupportedLegacy&&order.apiVersion!=='legacy'&&!chapaCurrentInline(order)&&order.chargeType!=='DIRECT')return <ChapaPaymentStatus payment={payment} onNavigate={onClose} onStartAgain={onStartAgain}/>;
 const retry=onStartAgain?()=>{void (async()=>{if(!bidPaymentCanRetry(payment.order))return;const checked=await payment.check();if(checked&&bidPaymentCanRetry(checked))onStartAgain()})()}:undefined;
 return <PaymentProgress purpose={purpose} footerPortal={false} payment={payment} summary={{auctionTitle:order?.auctionTitle??'',auctionTitleAm:order?.auctionTitleAm,numbers:order?.batchNumbers??batch?.lines.map(line=>line.number)??(order?.bidNumber?[order.bidNumber]:[]),total:order?.amount??amount,provider:order?.paymentMethod??payment.directAttempt?.paymentMethod??null,phone:payment.directAttempt?.phone??null}} onClose={onClose} onRetry={retry}/>;
}
