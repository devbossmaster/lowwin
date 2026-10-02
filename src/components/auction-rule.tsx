import {MiniPhrase} from './mini-locale';
import {RULE_V2,RULE_V3,V3_AMOUNT_TERMS,resultExplanation} from '@/modules/auctions/rules';

/** Version-aware disclosure: never apply future rules to a legacy auction. */
export function AuctionRule({ruleVersion,feePoints='0'}:{ruleVersion:string;feePoints?:string}){
 const hasFee=Number(feePoints)>0;
 return <div className="auction-rule" data-rule-version={ruleVersion}>
  {ruleVersion===RULE_V3&&<p><MiniPhrase en={V3_AMOUNT_TERMS} am="ዝቅተኛው የጨረታ መጠን 1.00 ብር ነው። እስከ ሁለት የአስርዮሽ ቦታዎች ያሉ መጠኖችን ማቅረብ ይችላሉ። በአንድ ጨረታ በአንድ ሳንቲም ልዩነት የሚከታተሉ አራት መጠኖችን ማቅረብ አይቻልም። ለምሳሌ፣ 1.01፣ 1.02 እና 1.03 ካቀረቡ፣ 1.04ን ይዝለሉ፤ 1.05 ይፈቀዳል። የሚያቀርቡበትን ቅደም ተከተል መቀየር ይህን ደንብ አያስቀርም። በአንድ ጨረታ እስከ 100 የተለያዩ መጠኖችን ማቅረብ ይችላሉ።"/></p>}
  {[RULE_V2,RULE_V3].includes(ruleVersion)?<>
   <p><MiniPhrase en={hasFee?'At least two eligible people must bid by the deadline. With fewer than two, the auction is cancelled, entry fees are refunded and all holds are released.':'At least two eligible people must bid by the deadline. With fewer than two, the auction is cancelled and all held money is released.'} am={hasFee?'እስከ መዝጊያ ሰዓቱ ቢያንስ ሁለት ተሳታፊዎች መጫረት አለባቸው። ካልተሟላ ጨረታው ይሰረዛል፣ ክፍያዎች ይመለሳሉ እና የተያዘው ገንዘብ ይለቀቃል።':'እስከ መዝጊያ ሰዓቱ ቢያንስ ሁለት ተሳታፊዎች መጫረት አለባቸው። ካልተሟላ ጨረታው ይሰረዛል እና የተያዘው ገንዘብ ይለቀቃል።'}/></p>
   <p><MiniPhrase en="The lowest amount accepted exactly once wins. Only when no amount is unique, the lowest submitted amount wins for the person whose bid at that amount was accepted first by the database. The database records a fixed acceptance order, even when timestamps match. A higher unique amount always takes priority over this fallback." am="አንድ ጊዜ ብቻ ከተቀበሉት መጠኖች ዝቅተኛው ያሸንፋል። አንድ ጊዜ ብቻ የቀረበ መጠን ከሌለ ብቻ፣ ዝቅተኛውን መጠን ያቀረቡት መካከል ጨረታው በመረጃ ቋቱ መጀመሪያ የተቀበለለት ሰው ያሸንፋል። የተመዘገበው ሰዓት ተመሳሳይ ቢሆንም መረጃ ቋቱ የማይለወጥ የቅደም ተከተል ቁጥር ይሰጣል። ከዚህ የበለጠ መጠን አንድ ጊዜ ብቻ ከቀረበ፣ ቅድሚያ ለዚያ ልዩ መጠን ይሰጣል።"/></p>
  </>:<p><MiniPhrase en="This auction keeps its original lowest-unique-v1 rules. The lowest amount accepted exactly once wins. If no amount is unique, there is no winner: holds are released and disclosed entry fees are retained. There is no two-person minimum or first-accepted fallback." am="ይህ ጨረታ የመጀመሪያውን lowest-unique-v1 ደንብ ይከተላል። አንድ ጊዜ ብቻ ከተቀበሉት መጠኖች ዝቅተኛው ያሸንፋል። ልዩ መጠን ከሌለ አሸናፊ አይኖርም፤ የተያዘው ገንዘብ ይለቀቃል፣ አስቀድመው የተገለጹ የመግቢያ ክፍያዎች ግን አይመለሱም። የሁለት ተሳታፊዎች ዝቅተኛ ገደብ ወይም ቀድሞ የተቀበለ ጨረታን የማስመረጥ አማራጭ አይኖርም።"/></p>}
  <p><MiniPhrase en={hasFee?'Only the winner’s winning amount is charged from held money. Other holds are released. Previously disclosed entry fees remain charged unless the auction is cancelled.':'Only the winner’s winning amount is charged. All other holds are released. There is no additional bid fee.'} am={hasFee?'ከአሸናፊው የተያዘ ገንዘብ የማሸነፊያው መጠን ብቻ ይቀነሳል። ሌሎች የተያዙ መጠኖች ይለቀቃሉ። ቀድሞ የተገለጹ ክፍያዎች ጨረታው ካልተሰረዘ ይቀራሉ።':'የአሸናፊው የማሸነፊያ መጠን ብቻ ይቀነሳል። ሌሎች የተያዙ መጠኖች ይለቀቃሉ። ተጨማሪ የጨረታ ክፍያ የለም።'}/></p>
 </div>;
}
export function ResultExplanation({outcome,decision}:{outcome:string;decision?:string|null}){
 const am=decision==='MINIMUM_PARTICIPANTS'?'በመዝጊያ ሰዓቱ ጨረታቸው የተቀበለላቸው ተሳታፊዎች ከሁለት ያነሱ ስለነበሩ ጨረታው በራሱ ተሰርዟል። የመግቢያ ክፍያዎች ሁሉ ተመልሰዋል፣ የተያዘው ገንዘብም ሁሉ ተለቋል።':decision==='FIRST_ACCEPTED_LOWEST'?'አንድ ጊዜ ብቻ የቀረበ መጠን አልነበረም። ዝቅተኛውን መጠን ያቀረቡት መካከል ጨረታው በመረጃ ቋቱ መጀመሪያ የተቀበለለት ተሳታፊ አሸንፏል። ያልተጠቀመው የተያዘ ገንዘብ ተለቋል፤ የተገለጹት የመግቢያ ክፍያዎች አልተመለሱም።':outcome==='WINNER'?'አንድ ጊዜ ብቻ ከተቀበሉት መጠኖች ዝቅተኛው አሸንፏል። ሌሎቹ የተያዙ መጠኖች ሁሉ ተለቀዋል።':outcome==='NO_WINNER'?'አንድ ጊዜ ብቻ የቀረበ መጠን አልነበረም። የተያዘው ገንዘብ ሁሉ ተለቋል፤ የተገለጹት የመግቢያ ክፍያዎች አልተመለሱም።':'ጨረታው ተሰርዟል። የተያዘው ገንዘብ እና የመግቢያ ክፍያዎች ሁሉ ተመልሰዋል።';
 return <MiniPhrase en={resultExplanation(outcome,decision)} am={am}/>;
}
