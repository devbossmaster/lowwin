export type MyBidsFilter='all'|'active'|'successful'|'pending'|'failed';
export function myBidsFilter(value:string|null,legacyView:string='all'):MyBidsFilter{
 if(value&&['all','active','successful','pending','failed'].includes(value))return value as MyBidsFilter;
 return legacyView==='live'?'active':legacyView==='history'?'successful':'all';
}
export function acceptedBidView(filter:MyBidsFilter,legacyView:string|null):'all'|'live'|'history'{return filter==='active'?'live':filter==='successful'&&legacyView==='history'?'history':'all'}

export function bidFeeNotice(status:'PAID'|'NOT_REQUIRED'|'UNAVAILABLE',am:boolean){
 if(status==='PAID')return am?'የተገለጸው የማቅረቢያ ክፍያ ብቻ ተከፍሏል። የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም።':'Only the disclosed submission fee was paid. Your chosen number is not money charged or reserved.';
 if(status==='NOT_REQUIRED')return am?'ለዚህ ጨረታ የማስገቢያ ክፍያ አልተከፈለም። የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም።':'No submission fee was charged for this entry. Your chosen number is not money charged or reserved.';
 return am?'የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም። የክፍያውን ሁኔታ በክፍያ መዝገቦችዎ ይመልከቱ።':'Your chosen number is not money charged or reserved. Check your payment records for the fee status.';
}
