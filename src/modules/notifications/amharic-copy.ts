import {centsToEtb,etbToCents} from '@/lib/money';
import {countdownUnits} from '@/lib/countdown-units';
import {isSubmissionFeeOnly} from '../auctions/rules';

export type AmharicNotificationCopy={title:string;body:string;buttonLabel:string};

/** Telegram messages use plain text, never HTML/Markdown from user profiles. */
function clean(value:string|undefined,limit:number){
 return Array.from((value??'').normalize('NFC').replace(/<\/?[A-Za-z][^>]{0,160}>/g,'').replace(/[\p{Cc}\p{Cf}<>]/gu,' ').replace(/\s+/g,' ').trim()).slice(0,limit).join('');
}
function greeting(name?:string){
 const safe=clean(name,60);
 // A display name is optional. A contact or email must never become a greeting.
 return safe&&!/(?:\+?\p{Nd}[\s().-]*){7,}/u.test(safe)&&!/[\w.+-]+@[^\s@]+\.[^\s@]+/.test(safe)?`ሰላም ${safe}፣\n\n`:'';
}
function money(value:string):bigint|null{
 try{const cents=etbToCents(value);return cents>=0n?cents:null}catch{return null}
}
const birr=(cents:bigint)=>`${centsToEtb(cents)} ብር`;

const daysAm=(days:number)=>`${days} ${days===1?'ቀን':'ቀናት'}`;
const hoursAm=(hours:number)=>`${hours} ${hours===1?'ሰዓት':'ሰዓታት'}`;
const minutesAm=(minutes:number)=>`${minutes} ${minutes===1?'ደቂቃ':'ደቂቃዎች'}`;

export function auctionCountdownAm(target:Date,now:Date){
 const [days,hours,minutes]=countdownUnits(target.getTime()-now.getTime()).map(Number);
 return [days&&daysAm(days),hours&&hoursAm(hours),minutes&&minutesAm(minutes)].filter(Boolean).join(' ከ')||'ከ1 ደቂቃ ያነሰ ጊዜ';
}

/** The manual promotion uses just one unit in its short, reviewed caption. */
export function auctionPromotionText(title:string,endsAt:Date,now:Date){
 const remaining=endsAt.getTime()-now.getTime();
 const [days,hours]=countdownUnits(remaining).map(Number);
 const opening=`${title}\n\nጨረታው ሊያበቃ`;
 if(!days&&!hours)return `${opening} ከ1 ሰዓት ያነሰ ጊዜ ቀርቷል።`;
 const approximate=remaining%(days?86_400_000:3_600_000)?'በግምት ':'';
 const duration=days?daysAm(days):hoursAm(hours);
 return `${opening} ${approximate}${duration} ${(days||hours)===1?'ቀርቷል':'ቀርተዋል'}።`;
}

/** Inputs are committed server amounts; this does not infer payment success. */
export function depositNotificationCopy(facts:{creditedAmount:string;depositAmount?:string;bonusAmount?:string;name?:string}):AmharicNotificationCopy|null{
 const credited=money(facts.creditedAmount),bonus=money(facts.bonusAmount??'0');
 if(credited===null||credited<=0n||bonus===null||bonus>credited)return null;
 const deposited=facts.depositAmount===undefined?credited-bonus:money(facts.depositAmount);
 if(deposited===null||deposited<=0n||deposited+bonus!==credited)return null;
 const breakdown=bonus>0n?`ያስገቡት: ${birr(deposited)}\nጉርሻ: ${birr(bonus)}\nበጠቅላላ የገባው: ${birr(credited)}`:`${birr(credited)} ወደ ዋሌትዎ ገብቷል።`;
 return {title:'✅ ገንዘብ ገብቷል',body:greeting(facts.name)+breakdown,buttonLabel:'ዋሌቴን ልይ'};
}

/** A chosen number is not the amount charged. Display the actual paid fee. */
export function bidPurchaseNotificationCopy(facts:{productTitle:string;numbers:readonly string[];paidFee:string;ruleVersion?:string;name?:string}):AmharicNotificationCopy|null{
 const product=clean(facts.productTitle,140),fee=money(facts.paidFee);
 if(!product||fee===null||facts.numbers.length<1||facts.numbers.length>100)return null;
 const numbers:bigint[]=[];
 for(const value of facts.numbers){const number=money(value);if(number===null||number<=0n||numbers.includes(number))return null;numbers.push(number)}
 const chosen=numbers.slice(0,12).map(centsToEtb).join(' · '),multiple=numbers.length>1;
 const label=facts.ruleVersion&&!isSubmissionFeeOnly(facts.ruleVersion)?'የጨረታ መጠን':multiple?'የመረጧቸው ቁጥሮች':'የመረጡት ቁጥር';
 const all=numbers.length>12?'\nሁሉንም ቁጥሮች በጨረታዎቼ ውስጥ ይመልከቱ።':'';
 return {title:'✅ ጨረታዎ ተመዝግቧል',body:`${greeting(facts.name)}${product}\n\n${label}: ${chosen}${numbers.length>12?' …':''}${multiple?`\nየቁጥሮች ብዛት: ${numbers.length}`:''}\nየተከፈለ የመመዝገቢያ ክፍያ: ${birr(fee)}${all}`,buttonLabel:'ጨረታዎቼን ልይ'};
}

/** Call only for the owner of a verified, published winning settlement. */
export function winnerNotificationCopy(facts:{productTitle:string;chosenNumber:string;ruleVersion?:string;name?:string}):AmharicNotificationCopy|null{
 const product=clean(facts.productTitle,140),number=money(facts.chosenNumber);
 if(!product||number===null||number<=0n)return null;
 const chosen=facts.ruleVersion&&!isSubmissionFeeOnly(facts.ruleVersion)?birr(number):centsToEtb(number);
 return {title:'🎉 እንኳን ደስ አለዎት፣ አሸንፈዋል!',body:`${greeting(facts.name)}የ${product} ጨረታን አሸንፈዋል።\nያሸነፈው ቁጥር: ${chosen}\n\nሽልማቱንና የርክክብ መረጃውን ከታች ይመልከቱ።`,buttonLabel:'ሽልማቴን ልይ'};
}

const closingReminder={title:'የጨረታ መዝጊያ ማስታወሻ',body:'የጨረታውን ዝርዝር ይመልከቱ።'};
const upcomingReminder={title:'መጪ ጨረታ',body:'የጨረታውን ዝርዝር ይመልከቱ።'};
const fallback:Record<string,{title:string;body:string}>={
 DEPOSIT_CREDITED:{title:'ገንዘብ ገብቷል',body:'የተረጋገጠውን ገቢ በዋሌትዎ ውስጥ ይመልከቱ።'},
 AUCTION_ENDING_3_DAYS:closingReminder,
 AUCTION_ENDING_2_DAYS:closingReminder,
 AUCTION_ENDING:closingReminder,
 AUCTION_ENDING_12_HOURS:closingReminder,
 AUCTION_ENDING_1_HOUR:closingReminder,
 AUCTION_ENDED:{title:'ጨረታው ተጠናቋል',body:'ውጤቱን ለማየት ከታች ይጫኑ።'},
 AUCTION_PUBLISHED:{title:'🔥 አዲስ ጨረታ ተከፍቷል',body:'ዕቃውንና የጨረታውን ውሎች ይመልከቱ።'},
 AUCTION_UPCOMING_ADDED:{title:'አዲስ መጪ ጨረታ ተጨምሯል',body:'ዕቃውንና የሚጀምርበትን ጊዜ ይመልከቱ።'},
 AUCTION_UPCOMING:upcomingReminder,
 AUCTION_UPCOMING_1_HOUR:upcomingReminder,
 BID_ACCEPTED:{title:'ጨረታዎ ተመዝግቧል',body:'የተመዘገቡትን ቁጥሮች በጨረታዎቼ ውስጥ ይመልከቱ።'},
 WINNER_CONGRATULATIONS:{title:'🎉 እንኳን ደስ አለዎት፣ አሸንፈዋል!',body:'ሽልማትዎንና የርክክብ መረጃውን ይመልከቱ።'},
};
/** Generic labels for old allowed inbox rows; never reconstruct private facts. */
export function fallbackAmharicNotificationCopy(kind:string):{title:string;body:string}|null{
 return Object.hasOwn(fallback,kind)?{...fallback[kind]}:null;
}
