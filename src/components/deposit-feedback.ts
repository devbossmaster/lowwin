export function depositFeedback(receipt:{status:string;reason?:string|null;points:string;reused?:boolean},translate:(text:string)=>string){
 const t=translate;
 if(receipt.status==='CREDITED')return {kind:'success' as const,message:receipt.reused?t('This transaction is already credited. No second credit was added.'):`${receipt.points} ${t('ETB credited. Receipt recorded.')}`};
 if(receipt.status==='NEEDS_REVIEW'){
  const reasons:Record<string,string>={
   DUPLICATE_REVIEW:'This receipt was already verified by the provider. An admin must review it before crediting.',
   DATE_MISMATCH:'The payment date could not be matched. Admin review is needed; your wallet is not credited.',
   AMOUNT_MISMATCH:'The amount does not match the deposit requirements. Admin review is needed.',
   RECEIVER_MISMATCH:'The receiving account does not match. Admin review is needed.',
   RECEIVER_UNPROVEN:'The receiving account could not be confirmed. Admin review is needed.',
   STALE_INTENT:'This deposit expired before verification finished. Contact support.',
   RECOVERY_REVIEW:'The earlier verification could not be recovered. Admin review is needed.',
  };
  return {kind:'info' as const,message:t(receipt.reused?'This transaction is already under admin review. It was not submitted again.':reasons[receipt.reason??'']??'Deposit needs admin review. Your wallet has not been credited.')};
 }
 if(receipt.status==='PROVIDER_OUTAGE')return {kind:'error' as const,message:t('Verification is unavailable. Your wallet has not been credited. Try again shortly.')};
 if(receipt.status==='DUPLICATE_CONFLICT')return {kind:'error' as const,message:t('This transaction has already been claimed. Contact support.')};
 if(receipt.status==='REJECTED')return {kind:'error' as const,message:t(receipt.reason==='ADMIN_REJECTED'?'An admin rejected this deposit. Contact support if you sent funds.':'Payment could not be verified. Check the receipt or contact support.')};
 return {kind:'info' as const,message:t(receipt.status==='VERIFYING'?'This deposit is being checked. Please wait.':'Payment is not confirmed yet. Your wallet has not been credited.')};
}
