import {chapaConfirmed,chapaVerifiedTerminal,type ChapaCheckoutView} from './chapa-client';

export function chapaStatusLabel(order:ChapaCheckoutView,am=false){
 const labels:Record<string,[string,string]>={CREDITED:['Wallet credited','ዋሌት ገብቷል'],BID_ACCEPTED:['Bid accepted','ጨረታው ተቀብሏል'],PENDING:['Waiting for confirmation','ማረጋገጫን በመጠባበቅ ላይ'],SUBMITTING:['Initiating checkout','ክፍያ በመጀመር ላይ'],FAILED:['Payment failed','ክፍያው አልተሳካም'],CANCELLED:['Payment cancelled','ክፍያው ተሰርዟል'],INCOMPLETE:['Authorization not completed','ፈቃዱ አልተጠናቀቀም'],EXPIRED:['Authorization expired','የፈቃዱ ጊዜ አልፏል'],AUTH_NEEDED:['Authorization required','ፈቃድ ያስፈልጋል'],BLOCKED:['Payment blocked','ክፍያው ታግዷል']};
 if(order.fundsPreserved)return am?'ክፍያው ደርሷል — ጨረታው አልተቀበለም':'Payment received — bid not accepted';
 if(chapaConfirmed(order))return (labels[order.status]??labels.PENDING)[am?1:0];
 if(chapaVerifiedTerminal(order))return (labels[order.status]??labels.PENDING)[am?1:0];
 if(order.reason==='INITIALIZATION_REJECTED')return am?'ክፍያው ሊጀመር አልቻለም':'Checkout could not start';
 if(order.verificationState==='MISMATCH'||order.status==='NEEDS_REVIEW')return am?'ማረጋገጥ ያስፈልጋል':'Needs verification';
 if(order.verificationState==='UNAVAILABLE'||order.verificationUnavailable)return am?'የመጀመሪያውን ክፍያ እያረጋገጥን ነው':'Checking original payment';
 if(order.status==='EXPIRED'&&order.providerStatus!=='EXPIRED')return am?'የመጀመሪያውን ክፍያ እያረጋገጥን ነው':'Checking original payment';
 return (labels[order.status]??labels.PENDING)[am?1:0];
}
