import {MiniPhrase} from './mini-locale';
import {RULE_V2,resultExplanation} from '@/modules/auctions/rules';

/** Version-aware disclosure: never apply future rules to a legacy auction. */
export function AuctionRule({ruleVersion}:{ruleVersion:string}){
 return <div className="auction-rule" data-rule-version={ruleVersion}>
  {ruleVersion===RULE_V2?<>
   <p><MiniPhrase en="At least two eligible people must have accepted bids by the deadline. Several bids by one person still count as one participant. With fewer than two, including no bids, the auction is cancelled: every entry fee is refunded and all held money is released." am="እስከ መዝጊያ ሰዓቱ ድረስ ቢያንስ ሁለት መስፈርቱን የሚያሟሉ ሰዎች ጨረታቸው ተቀባይነት ሊያገኝ ይገባል። አንድ ሰው ብዙ መጠኖችን ቢያቀርብም እንደ አንድ ተሳታፊ ብቻ ይቆጠራል። ተሳታፊዎች ከሁለት ያነሱ ከሆኑ፣ ወይም ጨረታ ካልቀረበ፣ ጨረታው ይሰረዛል፤ የመግቢያ ክፍያዎች ሁሉ ይመለሳሉ፣ የተያዘ ገንዘብም ሁሉ ይለቀቃል።"/></p>
   <p><MiniPhrase en="The lowest amount accepted exactly once wins. Only when no amount is unique, the lowest submitted amount wins for the person whose bid at that amount was accepted first by the database. The database records a fixed acceptance order, even when timestamps match. A higher unique amount always takes priority over this fallback." am="አንድ ጊዜ ብቻ ከተቀበሉት መጠኖች ዝቅተኛው ያሸንፋል። አንድ ጊዜ ብቻ የቀረበ መጠን ከሌለ ብቻ፣ ዝቅተኛውን መጠን ያቀረቡት መካከል ጨረታው በመረጃ ቋቱ መጀመሪያ የተቀበለለት ሰው ያሸንፋል። የተመዘገበው ሰዓት ተመሳሳይ ቢሆንም መረጃ ቋቱ የማይለወጥ የቅደም ተከተል ቁጥር ይሰጣል። ከዚህ የበለጠ መጠን አንድ ጊዜ ብቻ ከቀረበ፣ ቅድሚያ ለዚያ ልዩ መጠን ይሰጣል።"/></p>
  </>:<p><MiniPhrase en="This auction keeps its original lowest-unique-v1 rules. The lowest amount accepted exactly once wins. If no amount is unique, there is no winner: holds are released and disclosed entry fees are retained. There is no two-person minimum or first-accepted fallback." am="ይህ ጨረታ የመጀመሪያውን lowest-unique-v1 ደንብ ይከተላል። አንድ ጊዜ ብቻ ከተቀበሉት መጠኖች ዝቅተኛው ያሸንፋል። ልዩ መጠን ከሌለ አሸናፊ አይኖርም፤ የተያዘው ገንዘብ ይለቀቃል፣ አስቀድመው የተገለጹ የመግቢያ ክፍያዎች ግን አይመለሱም። የሁለት ተሳታፊዎች ዝቅተኛ ገደብ ወይም ቀድሞ የተቀበለ ጨረታን የማስመረጥ አማራጭ አይኖርም።"/></p>}
  <p><MiniPhrase en="On a completed winning auction, only the winner’s winning amount is charged from held money. All remaining holds are released and the disclosed entry fees are retained. Cancellation refunds all entry fees and releases all holds." am="አሸናፊ ኖሮት በተጠናቀቀ ጨረታ፣ ከአሸናፊው የተያዘ ገንዘብ የማሸነፊያው መጠን ብቻ ይቀነሳል። የቀረው የተያዘ ገንዘብ ሁሉ ይለቀቃል፤ የተገለጹት የመግቢያ ክፍያዎች አይመለሱም። ጨረታው ከተሰረዘ ግን የመግቢያ ክፍያዎች ሁሉ ይመለሳሉ፣ የተያዘው ገንዘብም ሁሉ ይለቀቃል።"/></p>
 </div>;
}
export function ResultExplanation({outcome,decision}:{outcome:string;decision?:string|null}){
 const am=decision==='MINIMUM_PARTICIPANTS'?'በመዝጊያ ሰዓቱ ጨረታቸው የተቀበለላቸው ተሳታፊዎች ከሁለት ያነሱ ስለነበሩ ጨረታው በራሱ ተሰርዟል። የመግቢያ ክፍያዎች ሁሉ ተመልሰዋል፣ የተያዘው ገንዘብም ሁሉ ተለቋል።':decision==='FIRST_ACCEPTED_LOWEST'?'አንድ ጊዜ ብቻ የቀረበ መጠን አልነበረም። ዝቅተኛውን መጠን ያቀረቡት መካከል ጨረታው በመረጃ ቋቱ መጀመሪያ የተቀበለለት ተሳታፊ አሸንፏል። ያልተጠቀመው የተያዘ ገንዘብ ተለቋል፤ የተገለጹት የመግቢያ ክፍያዎች አልተመለሱም።':outcome==='WINNER'?'አንድ ጊዜ ብቻ ከተቀበሉት መጠኖች ዝቅተኛው አሸንፏል። ሌሎቹ የተያዙ መጠኖች ሁሉ ተለቀዋል።':outcome==='NO_WINNER'?'አንድ ጊዜ ብቻ የቀረበ መጠን አልነበረም። የተያዘው ገንዘብ ሁሉ ተለቋል፤ የተገለጹት የመግቢያ ክፍያዎች አልተመለሱም።':'ጨረታው ተሰርዟል። የተያዘው ገንዘብ እና የመግቢያ ክፍያዎች ሁሉ ተመልሰዋል።';
 return <MiniPhrase en={resultExplanation(outcome,decision)} am={am}/>;
}
