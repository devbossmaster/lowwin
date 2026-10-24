'use client';
import Link from 'next/link';
import Image from 'next/image';
import {useState,type RefObject} from 'react';
import {Play} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {MiniPhrase} from './mini-locale';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
export default function LearnMoreSheet({onClose,videoId,media,returnFocusRef}:{onClose:()=>void;videoId?:string|null;media?:LearnMoreMedia|null;returnFocusRef?:RefObject<HTMLElement|null>}){
 const [watch,setWatch]=useState(false),[failed,setFailed]=useState(false),[posterFailed,setPosterFailed]=useState(false);
 const video=media??(videoId?{kind:'youtube' as const,id:videoId,poster:'/images/lowin-family-hero.webp'}:null);
 return <AccountSheet title={<MiniPhrase en="A little different wins" am="ትንሽ ልዩነት ያሸንፋል"/>} onClose={onClose} returnFocusRef={returnFocusRef}>
  <p className="learn-lead"><MiniPhrase en="Choose a number that stands on its own. The lowest number entered by just one person wins." am="በአንድ ሰው ብቻ የተመረጠ ቁጥር ይምረጡ። ዝቅተኛው ልዩ ቁጥር ያሸንፋል።"/></p>
  {video&&!failed&&<div className="learn-media">{!watch?<><Image src={posterFailed?'/images/lowin-family-hero.webp':video.poster} fill sizes="(max-width:480px) 100vw,480px" quality={75} alt="" onError={()=>setPosterFailed(true)}/><button className="learn-play" onClick={()=>setWatch(true)}><Play size={32} aria-hidden="true"/><MiniPhrase en="Play: How Lowwin works" am="አጫውት፦ Lowwin እንዴት ይሠራል"/></button></>:video.kind==='youtube'?<iframe src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1`} title="How Lowwin works" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>:<video src={video.src} poster={video.poster} preload="none" controls playsInline autoPlay onError={()=>setFailed(true)}><MiniPhrase en="Your browser cannot play this video. Read the steps below." am="ይህ ቪዲዮ ማጫወት አልተቻለም። ከታች ያሉትን ደረጃዎች ያንብቡ።"/></video>}</div>}
  {failed&&<p role="status"><MiniPhrase en="The video is unavailable. The complete explanation is below." am="ቪዲዮው አይገኝም። ሙሉ ማብራሪያው ከታች አለ።"/></p>}
  <ol className="learn-steps">
   <li><strong><MiniPhrase en="Find your next favourite" am="የሚወዱትን ዕቃ ይምረጡ"/></strong><p><MiniPhrase en="Open an auction. Check its closing time, submission fee and published terms." am="ጨረታውን ይክፈቱ። የመዝጊያ ጊዜውን፣ ክፍያውን እና ውሎቹን ያንብቡ።"/></p></li>
   <li><strong><MiniPhrase en="Choose your bid number" am="የጨረታ ቁጥርዎን ይምረጡ"/></strong><p><MiniPhrase en="Your number stays private while bidding is open. Review the exact fee before you confirm." am="ጨረታው ክፍት እስከሆነ ድረስ ቁጥርዎ የግል ነው። ከማረጋገጥዎ በፊት ትክክለኛውን ክፍያ ይመልከቱ።"/></p></li>
   <li><strong><MiniPhrase en="Come back for the result" am="ውጤቱን ይመልከቱ"/></strong><p><MiniPhrase en="After closing, Lowin finalizes the result using that auction’s rules. Only a confirmed result announces a winner." am="ከተዘጋ በኋላ Lowin በጨረታው ደንቦች መሠረት ውጤቱን ያረጋግጣል። አሸናፊ የሚታወቀው ውጤቱ ሲረጋገጥ ብቻ ነው።"/></p></li>
  </ol>
  <div className="learn-example"><h3><MiniPhrase en="A simple example" am="ቀላል ምሳሌ"/></h3><p><MiniPhrase en="Imagine the numbers are 2, 2, 4, 5, 5 and 7. Both 4 and 7 are unique. 4 wins because it is the lowest unique number." am="ቁጥሮቹ 2፣ 2፣ 4፣ 5፣ 5 እና 7 ቢሆኑ፣ 4 እና 7 ልዩ ናቸው። 4 ዝቅተኛው ልዩ ቁጥር ስለሆነ ያሸንፋል።"/></p><strong><MiniPhrase en="For current v4 auctions, your number is not money. Only the disclosed submission fee is charged; it is non-refundable." am="በአሁኑ v4 ጨረታዎች ቁጥርዎ ገንዘብ አይደለም። የሚከፈለው የተገለጸው የማስገቢያ ክፍያ ብቻ ሲሆን ተመላሽ አይሆንም።"/></strong></div>
  <p className="learn-fine"><MiniPhrase en="Older auctions follow their own published terms, including any reserve or winner payment. If no number is unique, the fallback written in that auction’s terms applies." am="የቆዩ ጨረታዎች የራሳቸውን የታተሙ ውሎች ይከተላሉ። ልዩ ቁጥር ከሌለ፣ በዚያ ጨረታ ውል የተጻፈው ደንብ ይተገበራል።"/></p>
  <div className="learn-links"><Link href="/terms"><MiniPhrase en="Terms" am="ውሎች"/></Link><Link href="/privacy"><MiniPhrase en="Privacy" am="ግላዊነት"/></Link><Link href="/faq"><MiniPhrase en="More questions?" am="ተጨማሪ ጥያቄዎች?"/></Link></div>
 </AccountSheet>;
}
