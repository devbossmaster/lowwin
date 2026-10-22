export type BilingualText={en:string;am:string};
export type FaqEntry={id:string;question:BilingualText;answer:BilingualText};
export type LegalDocument={title:BilingualText;intro?:BilingualText;closing?:BilingualText;effectiveDate?:string;updatedDate?:string;sections:{id:string;title:BilingualText;paragraphs:BilingualText[]}[]};
// Awaiting the owner's PDFs: do not invent policy text or publication dates.
export {termsDocument} from './help-policy';
import {faqEntries as policyFaqEntries} from './help-policy';
// Operational help follows the current interface; published legal text remains separate.
export const faqEntries:FaqEntry[]=policyFaqEntries.map(entry=>{
 if(entry.id==='number')return {...entry,answer:{en:'For current submission-fee auctions, your chosen number is not money charged or reserved. You pay only the fee shown before confirmation. For example, choosing 3.60 with a 30 ETB fee costs 30 ETB, not 33.60 ETB. Older auctions follow their own published payment terms.',am:'አሁን ባሉ የማቅረቢያ ክፍያ ጨረታዎች፣ የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም። ከማረጋገጥዎ በፊት የታየውን ክፍያ ብቻ ይከፍላሉ። ለምሳሌ፣ 3.60ን መርጠው ክፍያው 30 ብር ከሆነ ጠቅላላው 30 ብር ነው፣ 33.60 ብር አይደለም። የቀድሞ ጨረታዎች የራሳቸውን የታተሙ የክፍያ ውሎች ይከተላሉ።'}};
 if(entry.id==='photo')return {...entry,answer:{en:'Public results use an anonymous or masked winner. Your real photo or story is published only with your verified, explicit consent and admin moderation. Winning alone does not authorize a public photo announcement.',am:'የሕዝብ ውጤቶች ስሙ ያልተገለጸ ወይም በከፊል የተደበቀ አሸናፊ ያሳያሉ። እውነተኛ ፎቶዎ ወይም ታሪክዎ የሚታተመው በተረጋገጠ፣ ግልጽ ፈቃድዎ እና በአስተዳዳሪ ግምገማ ብቻ ነው። ማሸነፍ ብቻ ፎቶዎን ለሕዝብ ለማሳየት ፈቃድ አይሆንም።'}};
 return entry;
}).concat([
 {id:'direct-payment',question:{en:'How do I pay a submission fee?',am:'የማቅረቢያ ክፍያ እንዴት እከፍላለሁ?'},answer:{en:'Choose your number and review the actual fee. Existing available balances remain usable. When direct checkout is available, choose Telebirr or M-PESA and approve the request on your phone. A separate wallet deposit is not required. Your bid appears in My Bids only after the server confirms payment and accepts the bid.',am:'ቁጥርዎን ይምረጡና ትክክለኛውን ክፍያ ይመልከቱ። ነባር ለመጠቀም ያለ ቀሪ ሂሳብዎ ይሠራል። ቀጥታ ክፍያ ሲገኝ፣ Telebirr ወይም M-PESA ይምረጡና በስልክዎ የመጣውን ጥያቄ ያረጋግጡ። የተለየ የቦርሳ ተቀማጭ አያስፈልግም። ጨረታዎ በ«የእኔ ጨረታዎች» ውስጥ የሚታየው አገልጋዩ ክፍያውን አረጋግጦ ጨረታውን ከተቀበለ በኋላ ብቻ ነው።'}},
 {id:'pending-payment',question:{en:'What if my payment is pending or needs review?',am:'ክፍያዬ በመጠባበቅ ላይ ወይም ግምገማ ከፈለገ ምን ላድርግ?'},answer:{en:'Open Profile → Wallet & payment history → Bid payments, select the same payment and check its status. Do not pay again while it is unresolved. Pending is not an accepted bid. If a verified payment could not produce an accepted bid, its confirmed funds remain in your existing balance for review. Contact support with the payment ID.',am:'መገለጫ → የቦርሳ እና የክፍያ ታሪክ → የጨረታ ክፍያዎችን ይክፈቱ፣ ይህንኑ ክፍያ ይምረጡና ሁኔታውን ያረጋግጡ። እስኪፈታ ድረስ እንደገና አይክፈሉ። በመጠባበቅ ላይ ያለ ክፍያ የተቀበለ ጨረታ አይደለም። ክፍያው ተረጋግጦ ጨረታው ካልተቀበለ፣ የተረጋገጠው ገንዘብ ለግምገማ በነባር ቀሪዎ ይቆያል። በክፍያው መለያ ድጋፍ ያግኙ።'}},
]);
export const privacyDocument:LegalDocument={title:{en:'Privacy Policy',am:'የግላዊነት ፖሊሲ'},sections:[]};
