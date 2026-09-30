export function depositFeedback(receipt:{status:string;reason?:string|null;points:string;reused?:boolean},translate:(text:string)=>string){
 const t=translate;
 if(receipt.status==='CREDITED')return {kind:'success' as const,message:receipt.reused?t('This transaction is already credited. No second credit was added.'):`${receipt.points} ${t('ETB credited. Receipt recorded.')}`};
 if(receipt.status==='NEEDS_REVIEW'){
  const reasons:Record<string,string>={
   INCOMPLETE_EVIDENCE:'The verification needs more evidence. Your wallet was not credited.',
   DATE_MISMATCH:'The payment date could not be matched. Admin review is needed; your wallet is not credited.',
   AMOUNT_MISMATCH:'The amount does not match the deposit requirements. Admin review is needed.',
   RECEIVER_MISMATCH:'The receiving account does not match. Admin review is needed.',
   RECEIVER_UNPROVEN:'The receiving account could not be confirmed. Admin review is needed.',
   STALE_INTENT:'This deposit expired before verification finished. Contact support.',
   PROVIDER_UNAVAILABLE:'Verification did not finish. Contact support with your deposit ID.',
  };
  return {kind:'info' as const,message:t(reasons[receipt.reason??'']??'Payment needs more evidence — you can check again.')};
 }
 if(receipt.status==='PROVIDER_OUTAGE'){
  const reasons:Record<string,string>={PROVIDER_AUTH:'Payment verification configuration needs attention. Contact support.',PROVIDER_UNCONFIGURED:'Payment verification configuration needs attention. Contact support.',PROVIDER_QUOTA:'Payment verification quota is exhausted. Contact support.',PROVIDER_RATE_LIMIT:'Too many verification requests. Retry after the time shown.'};
  return {kind:'error' as const,message:t(reasons[receipt.reason??'']??'Verification temporarily unavailable — retry after the time shown.')};
 }
 if(receipt.status==='DUPLICATE_CONFLICT')return {kind:'error' as const,message:t('This transaction is claimed by another account — contact support.')};
 if(receipt.status==='REJECTED')return {kind:'error' as const,message:t(receipt.reason==='ADMIN_REJECTED'?'An admin rejected this deposit. Contact support if you sent funds.':'Payment could not be verified. Check the receipt or contact support.')};
 return {kind:'info' as const,message:t(receipt.status==='VERIFYING'?'This deposit is being checked. Please wait.':'Payment is not confirmed yet. Your wallet has not been credited.')};
}
