'use client';
import Link from 'next/link';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import {MiniPhrase} from './mini-locale';
import {TutorialVideo} from './tutorial-video';
import styles from './tutorial.module.css';
export type TutorialProps={media?:LearnMoreMedia|null;intro?:{en:string;am:string}};
export function TutorialContent({media,intro}:{media?:LearnMoreMedia|null;intro?:{en:string;am:string}}){
 return <div className={styles.content}>
  <p className={styles.lead}><MiniPhrase en={intro?.en||'Choose a number that stands on its own. The lowest number entered by just one player wins.'} am={intro?.am||'በአንድ ተጫራች ብቻ የተመረጠ ቁጥር ይምረጡ። ዝቅተኛው ልዩ ቁጥር ያሸንፋል።'}/></p>
  <TutorialVideo media={media??null}/>
  <ol className={styles.steps}>
   <li><span aria-hidden="true">1</span><div><h2><MiniPhrase en="Find an auction" am="ጨረታ ይምረጡ"/></h2><p><MiniPhrase en="Check the product, closing time, submission fee and published rules." am="ዕቃውን፣ የመዝጊያ ጊዜውን፣ የማስገቢያ ክፍያውን እና የጨረታውን ደንቦች ያንብቡ።"/></p></div></li>
   <li><span aria-hidden="true">2</span><div><h2><MiniPhrase en="Choose your bid amount" am="የጨረታ መጠንዎን ይምረጡ"/></h2><p><MiniPhrase en="Your selection stays private while bidding is open. Review your entries and exact submission fee before paying." am="ጨረታው ክፍት እስከሆነ ድረስ የመረጡት መጠን የግል ነው። ከመክፈልዎ በፊት ምርጫዎችዎን እና ትክክለኛውን የማስገቢያ ክፍያ ይመልከቱ።"/></p></div></li>
   <li><span aria-hidden="true">3</span><div><h2><MiniPhrase en="Return for the result" am="ውጤቱን ይመልከቱ"/></h2><p><MiniPhrase en="Bidding closes at the published deadline. Lowwin checks the result, then publishes the confirmed winner in Winners." am="ጨረታው በተገለጸው ጊዜ ይዘጋል። Lowwin ውጤቱን አረጋግጦ አሸናፊውን በአሸናፊዎች ገጽ ያሳውቃል።"/></p></div></li>
  </ol>
  <section className={styles.example}><h2><MiniPhrase en="How a unique bid wins" am="ልዩ ጨረታ እንዴት ያሸንፋል?"/></h2><div className={styles.numbers} aria-label="2, 2, 4, 5, 5, 7">{[2,2,4,5,5,7].map((number,index)=><span key={index} data-winner={index===2||undefined}>{number}</span>)}</div><p><MiniPhrase en="4 and 7 were each chosen once. 4 wins because it is the lowest unique amount." am="4 እና 7 እያንዳንዳቸው አንድ ጊዜ ብቻ ተመርጠዋል። 4 ዝቅተኛው ልዩ መጠን ስለሆነ ያሸንፋል።"/></p></section>
  <p className={styles.fine}><MiniPhrase en="In current fee-only auctions, your selected amount is not charged. You pay the disclosed, non-refundable submission fee. Older auctions follow their own published rules, including any winner payment or fallback when no amount is unique." am="በአሁኑ የማስገቢያ ክፍያ ብቻ ባለባቸው ጨረታዎች የመረጡት መጠን አይከፈልም። የሚከፍሉት የተገለጸውን ተመላሽ የማይሆን የማስገቢያ ክፍያ ነው። የቆዩ ጨረታዎች የአሸናፊ ክፍያን ወይም ልዩ መጠን ከሌለ የሚወሰደውን እርምጃ ጨምሮ የራሳቸውን የታተሙ ደንቦች ይከተላሉ።"/></p>
  <nav className={styles.links} aria-label="More information"><Link href="/terms"><MiniPhrase en="Terms" am="ውሎች"/></Link><Link href="/privacy"><MiniPhrase en="Privacy" am="ግላዊነት"/></Link><Link href="/"><MiniPhrase en="Explore auctions" am="ጨረታዎችን ይመልከቱ"/></Link></nav>
 </div>;
}
