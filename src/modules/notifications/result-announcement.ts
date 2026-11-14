import {formatAuctionBid} from '@/lib/money';
type Facts={title:string;titleAm?:string|null;code:string;outcome:string;decision:string|null;ruleVersion:string;winningPoints:string|null;displayName:string|null;username:string|null;phoneMasked:string|null;publishedAt:Date};
const clean=(value:string,limit:number)=>Array.from(value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,limit).join('');
/** Only published winner facts. Never expose handles, IDs or full contacts. */
export function resultAnnouncement(facts:Facts){
 const decision=facts.decision??(facts.ruleVersion==='lowest-unique-v1'?'LOWEST_UNIQUE':null);
 if(facts.outcome!=='WINNER'||!facts.winningPoints||!['LOWEST_UNIQUE','FIRST_ACCEPTED_LOWEST'].includes(decision??''))return null;
 const title=clean(facts.title,100),amTitle=clean(facts.titleAm||facts.title,100),number=formatAuctionBid(facts.winningPoints,facts.ruleVersion),amount=number.startsWith('ETB ')?number:`ETB ${number}`,name=clean(facts.displayName||'LowWin player',80);
 const phone=facts.phoneMasked&&/^\+\d+\*{3}\d+$/.test(facts.phoneMasked)?facts.phoneMasked:null;
 return {
  title:'Winner announced · አሸናፊው ታውቋል',
  body:`${title}\nWinner: ${name}${phone?' · '+phone:''} · Winning bid: ${amount}\nአሸናፊ: ${name}${phone?' · '+phone:''} · ያሸነፈው ቁጥር: ${amount}`,
  telegramCaption:`🏆 ${title}${amTitle!==title?'\n'+amTitle:''}\n${name}${phone?'\n'+phone:''}\nWinning bid · ያሸነፈው ቁጥር: ${amount}`,
  buttonLabel:'View result · ውጤቱን ይመልከቱ',href:`/winners/${encodeURIComponent(facts.code)}`,
 };
}
