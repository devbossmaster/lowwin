'use client';
import {useCallback,useState} from 'react';

/** Shared draft navigation has no financial side effects. Only explicit Pay
 * commands may initialize a provider request or debit a wallet. */
export function usePaymentCheckoutFlow(){
 const [step,setStep]=useState<'entry'|'payment'>('entry');
 const continueToPayment=useCallback(()=>setStep('payment'),[]);
 const editDraft=useCallback(()=>setStep('entry'),[]);
 const retryDraft=useCallback(()=>setStep('entry'),[]);
 return {step,continueToPayment,editDraft,retryDraft};
}
