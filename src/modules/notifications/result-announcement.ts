import {formatAuctionBid} from '@/lib/money';

type Facts={title:string;titleAm?:string|null;code:string;outcome:string;decision:string|null;ruleVersion:string;winningPoints:string|null;displayName:string|null;username:string|null;phoneMasked:string|null;publishedAt:Date};
const clean=(value:string,limit:number)=>Array.from(value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,limit).join('');

/** Public facts only. This function never receives contact ciphers, Telegram
 * IDs, unrestricted users or a live-bid collection. */
export function resultAnnouncement(facts:Facts){
 const title=clean(facts.title,100),amTitle=clean(facts.titleAm||facts.title,100),item=`${title} · #${facts.code}`;
 const winner=facts.outcome==='WINNER';
 // The original frozen v1 algorithm recorded no decision enum and only ever
 // selected a lowest unique winner. Later rules require their explicit proof.
 const decision=facts.decision??(facts.ruleVersion==='lowest-unique-v1'?'LOWEST_UNIQUE':null);
 if(!['WINNER','NO_WINNER','CANCELLED'].includes(facts.outcome)||winner&&(!facts.winningPoints||!['LOWEST_UNIQUE','FIRST_ACCEPTED_LOWEST'].includes(decision??'')))return null;
 const number=winner?formatAuctionBid(facts.winningPoints!,facts.ruleVersion):null;
 const identity=[facts.displayName,facts.username,facts.phoneMasked].filter(Boolean).join(' · ');
 const selection=decision==='FIRST_ACCEPTED_LOWEST'
  ?['Earliest bid at the lowest number—no unique number existed.','አንድ ጊዜ ብቻ የቀረበ ቁጥር ስላልነበረ፣ ዝቅተኛውን ቁጥር ቀድሞ ያቀረበው አሸንፏል።']
  :['Lowest unique number.','አንድ ጊዜ ብቻ የቀረበው ዝቅተኛ ቁጥር።'];
 const resultEn=winner?`Winner: ${identity||'Lowwin player'} · Winning number: ${number}. ${selection[0]}`:facts.outcome==='CANCELLED'?'Auction cancelled. See the final result and fee policy.':'The auction closed without a winner. See the final result.';
 const resultAm=winner?`አሸናፊ፦ ${identity||'የLowwin ተጫራች'} · ያሸነፈው ቁጥር፦ ${number}። ${selection[1]}`:facts.outcome==='CANCELLED'?'ጨረታው ተሰርዟል። የታተመውን ውጤት እና የጨረታውን የክፍያ ውል ይመልከቱ።':'ጨረታው ያለ አሸናፊ ተዘግቷል። የመጨረሻ ውጤቱን ይመልከቱ።';
 const announced=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'}).format(facts.publishedAt)+' EAT';
 return {
  title:'Result announced · ውጤቱ ታውቋል',
  body:`${item}\n${resultEn}\n${resultAm}\nAnnounced · የታወጀበት: ${announced}`,
  telegramCaption: `${winner?'🏆':'🏁'} ${title}${amTitle!==title?'\n'+amTitle:''}\n${winner?`${identity||'Winner · አሸናፊ'}\nWinning number · ያሸነፈው ቁጥር: ${number}\n${selection[0]}\n${selection[1]}`:`${resultEn}\n${resultAm}`}\nAnnounced · የታወጀበት: ${announced}\n#${facts.code}`,
  buttonLabel:'View result · ውጤቱን ይመልከቱ',href:`/winners/${encodeURIComponent(facts.code)}`,
 };
}
