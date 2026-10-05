type AlertCopy = {kind?:string;title:string;body:string};
const messages:Record<string,[string,string,string]>={
 BID_ACCEPTED:['Bid accepted','ጨረታዎ ተቀብሏል','የተቀበለውን ጨረታዎን ደረሰኝ በ«የእኔ ጨረታዎች» ውስጥ ማየት ይችላሉ።'],
 AUCTION_CLOSED:['Auction closed','ጨረታው ተዘግቷል','የጨረታዎን ውጤት እና ከእገዳ የተለቀቀውን ገንዘብ ማየት ይችላሉ።'],
 AUCTION_WON:['You won this auction','ይህን ጨረታ አሸንፈዋል','የመጨረሻ ውጤትዎ ዝግጁ ነው። ሽልማትዎን ለመቀበል መመሪያውን በ«ያሸነፍኳቸው ጨረታዎች» ውስጥ ይመልከቱ።'],
 AUCTION_NO_WINNER:['No unique winner','ጨረታው ያለ አሸናፊ ተዘግቷል','አንድ ጊዜ ብቻ የቀረበ መጠን ስላልነበረ ጨረታው ያለ አሸናፊ ተዘግቷል። የተያዘው ገንዘብ ተለቋል፤ አስቀድሞ የተገለጹት የመግቢያ ክፍያዎች ግን አልተመለሱም።'],
 AUCTION_CANCELLED:['Auction cancelled','ጨረታው ተሰርዟል','ለጨረታው የተያዘው ገንዘብ ተለቋል፣ የተከፈሉትም የመግቢያ ክፍያዎች ተመልሰዋል።'],
 AUCTION_MINIMUM_CANCELLED:['Auction cancelled: participant minimum not met','ጨረታው በቂ ተሳታፊዎች ስላልነበሩት ተሰርዟል','መስፈርቱን የሚያሟሉ ተሳታፊዎች ከሁለት ያነሱ ነበሩ። ሁሉም የመግቢያ ክፍያዎች ተመልሰዋል፣ የተያዘውም ገንዘብ ሁሉ ተለቋል።'],
 AUCTION_FALLBACK_WON:['You won: first accepted lowest bid','ዝቅተኛውን መጠን ቀድመው በማቅረብ አሸንፈዋል','አንድ ጊዜ ብቻ የቀረበ መጠን አልነበረም። በዝቅተኛው መጠን ከቀረቡት ጨረታዎች የእርስዎ በመረጃ ቋቱ መጀመሪያ ተቀብሏል። የመጨረሻ ውጤቱን እና የማድረስ ዝርዝሩን ይመልከቱ።'],
 FULFILLMENT_UPDATED:['Delivery update','የማድረስ ሁኔታ ተዘምኗል','ያሸነፉበትን ጨረታ ከፍተው የሽልማትዎን የማድረስ ሁኔታ ይመልከቱ።'],
 AUCTION_START:['A saved auction is open','ያስቀመጡት ጨረታ ተጀምሯል','በተወዳጆችዎ ውስጥ ያስቀመጡት ጨረታ አሁን ተጀምሯል።'],
 FAVORITE_ENDING:['A saved auction ends soon','ያስቀመጡት ጨረታ በቅርቡ ያበቃል','በተወዳጆችዎ ውስጥ ያስቀመጡትን ጨረታ ከፍተው የመዝጊያ ሰዓቱን ይመልከቱ።'],
};
// Translate the display only; stored messages and financial records stay intact.
export function notificationCopy(item:AlertCopy,language:'en'|'am'){
 const campaigns:Record<string,[string,string]>={AUCTION_UPCOMING:['Starts in less than 24 hours','\u12a824 \u1230\u12d3\u1275 \u1260\u1273\u127d \u130a\u12dc \u12cd\u1235\u1325 \u12ed\u1300\u121d\u122b\u120d'],AUCTION_PUBLISHED:['New auction','አዲስ ጨረታ'],AUCTION_ENDING:['Less than one day left','ከአንድ ቀን ያነሰ ጊዜ ቀርቷል'],AUCTION_RESULT:['Auction finished','ጨረታው ተጠናቋል'],DEPOSIT_CREDITED:['Deposit successful','ገንዘቡ ገብቷል'],BROADCAST:['Lowwin update','የLowwin መረጃ']};
 const campaign=item.kind?campaigns[item.kind]:undefined;
 if(campaign){
  const lines=item.body.split('\n'),am=language==='am';
  const body=item.kind==='BROADCAST'?item.body:item.kind==='DEPOSIT_CREDITED'?(lines[am?1:0]??item.body):[lines[0],lines[am?2:1],...lines.slice(3)].filter(Boolean).join('\n');
  return {title:`${item.title.startsWith('DEMO · ')?'DEMO · ':''}${campaign[am?1:0]}`,body};
 }
 if(language!=='am')return {title:item.title,body:item.body};
 const demo=item.title.startsWith('DEMO · '),title=demo?item.title.slice(7):item.title;
 const copy=(item.kind?messages[item.kind]:undefined)??Object.values(messages).find(value=>value[0]===title);
 return copy?{title:`${demo?'DEMO · ':''}${copy[1]}`,body:copy[2]}:{title:item.title,body:item.body};
}
export function notificationAge(date:string,language:'en'|'am',now=Date.now()){
 const seconds=Math.max(0,(now-new Date(date).getTime())/1000),locale=language==='am'?'am-ET':'en';
 if(seconds<60)return language==='am'?'አሁን':'Just now';
 const relative=new Intl.RelativeTimeFormat(locale,{numeric:'auto'});
 for(const [limit,divisor,unit] of [[3600,60,'minute'],[86400,3600,'hour'],[604800,86400,'day'],[2592000,604800,'week']] as const){
  if(seconds<limit)return relative.format(-Math.floor(seconds/divisor),unit);
 }
 return new Date(date).toLocaleDateString(locale,{month:'short',day:'numeric'});
}
