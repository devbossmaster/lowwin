export type BidPaymentAttemptFilter='all'|'pending'|'failed'|'cancelled'|'review';
export type MyBidsFilter=BidPaymentAttemptFilter|'active'|'completed'|'successful';
export type MyBidsSection='accepted'|'attempts';
export function myBidsFilter(value:string|null,legacyView:string='all'):MyBidsFilter{
 if(value&&['all','active','completed','successful','pending','failed','cancelled','review'].includes(value))return value as MyBidsFilter;
 return legacyView==='live'?'active':legacyView==='history'?'successful':'all';
}
export function acceptedBidView(filter:MyBidsFilter,legacyView:string|null):'all'|'live'|'history'{return filter==='active'?'live':filter==='completed'||filter==='successful'&&legacyView==='history'?'history':'all'}
export function myBidsSelection(sectionValue:string|null,value:string|null,legacyView='all'):{section:'accepted';filter:'all'|'active'|'completed'}|{section:'attempts';filter:BidPaymentAttemptFilter}{
 const requested=myBidsFilter(value,legacyView),attempt=['pending','failed','cancelled','review'].includes(requested);
 const section=sectionValue==='accepted'||sectionValue==='attempts'?sectionValue:attempt?'attempts':'accepted';
 if(section==='accepted')return {section,filter:requested==='active'?'active':requested==='completed'||requested==='successful'&&legacyView==='history'?'completed':'all'};
 return {section,filter:attempt?requested as BidPaymentAttemptFilter:'all'};
}

export function bidFeeNotice(status:'PAID'|'NOT_REQUIRED'|'UNAVAILABLE',am:boolean){
 if(status==='PAID')return am?'የተገለጸው የማቅረቢያ ክፍያ ብቻ ተከፍሏል። የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም።':'Only the disclosed submission fee was paid. Your chosen number is not money charged or reserved.';
 if(status==='NOT_REQUIRED')return am?'ለዚህ ጨረታ የማስገቢያ ክፍያ አልተከፈለም። የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም።':'No submission fee was charged for this entry. Your chosen number is not money charged or reserved.';
 return am?'የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም። የክፍያውን ሁኔታ በክፍያ መዝገቦችዎ ይመልከቱ።':'Your chosen number is not money charged or reserved. Check your payment records for the fee status.';
}
