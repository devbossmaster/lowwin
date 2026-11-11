'use client';
import {useCallback,useState} from 'react';

/** Shared draft navigation has no financial side effects. Only explicit Pay
 * commands may initialize a provider request or debit a wallet. */
export function usePaymentCheckoutFlow(){
 const [step,setStep]=useState<'entry'|'review'|'payment'|'guide'>('entry');
 const continueToPayment=useCallback((review=false)=>setStep(review?'review':'payment'),[]);
 const openPayment=useCallback(()=>setStep('payment'),[]);
 const showGuide=useCallback(()=>setStep('guide'),[]);
 const editDraft=useCallback(()=>setStep('entry'),[]);
 const retryDraft=useCallback(()=>setStep('entry'),[]);
 return {step,continueToPayment,openPayment,showGuide,editDraft,retryDraft};
}
