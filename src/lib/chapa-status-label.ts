import {chapaConfirmed,type ChapaCheckoutView} from './chapa-client';

export function chapaStatusLabel(order:ChapaCheckoutView,am=false){
 const labels:Record<string,[string,string]>={CREDITED:['Wallet credited','ዋሌት ገብቷል'],BID_ACCEPTED:['Bid accepted','ጨረታው ተቀብሏል'],PENDING:['Pending','በመጠባበቅ ላይ'],SUBMITTING:['Initiating checkout','ክፍያ በመጀመር ላይ'],FAILED:['Payment failed','ክፍያው አልተሳካም'],CANCELLED:['Cancelled','ተሰርዟል'],INCOMPLETE:['Incomplete','አልተጠናቀቀም'],EXPIRED:['Not completed','አልተጠናቀቀም'],AUTH_NEEDED:['Authorization required','ፈቃድ ያስፈልጋል'],BLOCKED:['Payment blocked','ክፍያው ታግዷል']};
 if(order.fundsPreserved)return am?'ክፍያው ደርሷል — ጨረታው አልተቀበለም':'Payment received — bid not accepted';
 if(chapaConfirmed(order))return (labels[order.status]??labels.PENDING)[am?1:0];
 if(order.reason==='INITIALIZATION_REJECTED')return am?'ክፍያው ሊጀመር አልቻለም':'Checkout could not start';
 if(order.verificationState==='MISMATCH'||order.status==='NEEDS_REVIEW')return am?'ማረጋገጥ ያስፈልጋል':'Needs verification';
 if(order.verificationState==='UNAVAILABLE')return am?'ማረጋገጥ ያስፈልጋል':'Needs verification';
 return (labels[order.status]??labels.PENDING)[am?1:0];
}
