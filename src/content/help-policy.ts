import type {BilingualText,LegalDocument,FaqEntry} from './help';
const text=(en:string,am:string):BilingualText=>({en,am});
const definitions=[
 text('LowWin is the digital auction platform operating through a Telegram Bot and/or mobile application.','ሎውዊን በቴሌግራም ቦት እና/ወይም በሞባይል መተግበሪያ የሚሠራ ዲጂታል የጨረታ መድረክ ነው።'),
 text('Bid number: Your chosen number, not a payment amount. No money is held or charged for the number, even if it wins. Unique bid: A number submitted by exactly one participant. The winning bid is the lowest unique number, or the number selected by the fallback in section 3.','የጨረታ ቁጥር፦ የመረጡት ቁጥር ነው፤ የክፍያ መጠን አይደለም። ቢያሸንፍም ለቁጥሩ ገንዘብ አይያዝም ወይም አይቀነስም። ብቸኛ ጨረታ፦ አንድ ተሳታፊ ብቻ ያቀረበው ቁጥር። አሸናፊው ጨረታ ዝቅተኛው ብቸኛ ቁጥር፣ ወይም በክፍል 3 ባለው አማራጭ ደንብ የተመረጠው ቁጥር ነው።'),
 text('Submission fee (ticket fee): The fee for each accepted bid. LowWin sets it separately for each auction and shows it before confirmation. It is non-refundable, including when an auction is cancelled.','የማቅረቢያ ክፍያ (የትኬት ክፍያ)፦ ለእያንዳንዱ የተቀበለ ጨረታ የሚከፈል ክፍያ። ሎውዊን ለእያንዳንዱ ጨረታ በተለየ ይወስነዋል፣ ከማረጋገጥዎም በፊት ያሳየዋል። ጨረታው ቢሰረዝም ተመላሽ አይሆንም።')
];
const eligibility=[
 text('Participants must be 18 or older and use only one Telegram account per person. Users must provide accurate and truthful personal information.','ተሳታፊዎች 18 ዓመት ወይም ከዚያ በላይ መሆን፣ በአንድ ሰው አንድ የቴሌግራም መለያ ብቻ መጠቀምና ትክክለኛ እውነተኛ የግል መረጃ መስጠት አለባቸው።'),
 text('Winners must provide valid identification before receiving a prize.','አሸናፊዎች ሽልማታቸውን ከመቀበላቸው በፊት ትክክለኛ መታወቂያ ማቅረብ አለባቸው።')
];
const winning=[
 text('The lowest number submitted by exactly one participant wins. A number submitted by two or more participants is not unique. For example, if two people choose 1.00 and one chooses 2.00, the 2.00 entry wins.','አንድ ተሳታፊ ብቻ ካቀረባቸው ቁጥሮች ዝቅተኛው ያሸንፋል። ሁለት ወይም ከዚያ በላይ ሰዎች ያቀረቡት ቁጥር ብቸኛ አይደለም። ለምሳሌ፣ ሁለት ሰዎች 1.00 እና አንድ ሰው 2.00 ከመረጡ፣ 2.00 ያቀረበው ያሸንፋል።'),
 text('Only when no number is unique, the lowest submitted number wins for the participant whose bid at that number the system accepted first. Unique numbers always take priority. The system records and acceptance order are final and binding.','ብቸኛ ቁጥር ከሌለ ብቻ፣ ዝቅተኛውን ቁጥር ካቀረቡት መካከል ጨረታው በሲስተሙ መጀመሪያ የተቀበለለት ያሸንፋል። ብቸኛ ቁጥሮች ሁልጊዜ ቅድሚያ አላቸው። የሲስተሙ መዝገቦችና የመቀበያ ቅደም ተከተል የመጨረሻና አስገዳጅ ናቸው።'),
 text('Choose a number from 1.00 in 0.01 steps, with no configured maximum. Up to 100 different numbers per participant are allowed. Do not repeat your own number or submit four consecutive numbers separated by 0.01. After 1.01, 1.02 and 1.03, skip 1.04; 1.05 is allowed. Changing submission order does not bypass this rule.','ከ1.00 ጀምሮ በ0.01 ልዩነት ቁጥር ይምረጡ፤ የተወሰነ ከፍተኛ ቁጥር የለም። በአንድ ተሳታፊ እስከ 100 የተለያዩ ቁጥሮች ይፈቀዳሉ። የራስዎን ቁጥር አይድገሙ፤ በ0.01 ልዩነት የሚከታተሉ አራት ቁጥሮችንም አያቅርቡ። ከ1.01፣ 1.02 እና 1.03 በኋላ 1.04ን ይዝለሉ፤ 1.05 ይፈቀዳል። የማቅረቢያ ቅደም ተከተልን መቀየር ደንቡን አያስቀርም።'),
 text('At least two eligible participants must have accepted bids by the deadline. Otherwise the auction is cancelled and no prize is awarded. Accepted submission fees remain non-refundable.','እስከ መዝጊያ ሰዓቱ ጨረታቸው የተቀበለላቸው ቢያንስ ሁለት ብቁ ተሳታፊዎች ያስፈልጋሉ። ካልተሟላ ጨረታው ይሰረዛል፣ ሽልማትም አይሰጥም። ለተቀበሉ ጨረታዎች የተከፈሉ ክፍያዎች አይመለሱም።')
];
const payment=[
 text('Fund your wallet through Telebirr or another payment method offered in the app. For each accepted bid, pay only the displayed submission fee. Choosing 3.60 with a 30 ETB fee costs 30 ETB total, not 33.60 ETB. Winning adds no charge for the chosen number.','በቴሌብር ወይም በመተግበሪያው በሚቀርብ ሌላ የክፍያ ዘዴ ቦርሳዎን ይሙሉ። ለእያንዳንዱ የተቀበለ ጨረታ የታየውን የማቅረቢያ ክፍያ ብቻ ይከፍላሉ። 3.60ን መርጠው ክፍያው 30 ብር ከሆነ ጠቅላላ ክፍያው 30 ብር ነው፤ 33.60 ብር አይደለም። ማሸነፍ ለመረጡት ቁጥር ተጨማሪ ክፍያ አያስከትልም።'),
 text('Accepted submission fees are non-refundable for all outcomes, including cancellation by LowWin or insufficient participation. Rejected submissions are not charged. Every additional accepted bid incurs the fee displayed at confirmation.','የተቀበሉ ጨረታዎች ክፍያዎች ለሁሉም ውጤቶች፣ ሎውዊን ጨረታውን ቢሰርዝም ወይም ተሳታፊዎች ባይበቁም፣ ተመላሽ አይሆኑም። ውድቅ ለሆኑ ጨረታዎች ክፍያ አይቀነስም። እያንዳንዱ ተጨማሪ የተቀበለ ጨረታ ሲያረጋግጡ የታየውን ክፍያ ያስከፍላል።'),
 text('Winners are notified through the Telegram Bot or application when results are ready. Confirm your details through the bot within 14 days of notification. Failure to respond within that period results in forfeiture of the prize.','ውጤቶቹ ሲዘጋጁ አሸናፊዎች በቴሌግራም ቦቱ ወይም በመተግበሪያው ይነገራቸዋል። ማሳወቂያው ከደረሰዎት በ14 ቀናት ውስጥ በቦቱ በኩል መረጃዎን ያረጋግጡ። በዚህ ጊዜ ውስጥ ምላሽ ካልሰጡ ሽልማቱን የመቀበል መብትዎ ይሰረዛል።')
];
const prize=[
 text('Verification takes up to 72 hours after the auction ends, after which handover begins. Follow the delivery information and region shown on the auction page.','ጨረታው ካበቃ በኋላ ማረጋገጫው እስከ 72 ሰዓታት ይወስዳል፤ ከዚያ በኋላ ርክክብ ይጀምራል። በጨረታው ገጽ የተገለጹትን የማስረከቢያ መረጃና ቦታ ይከተሉ።'),
 text('Winners pay all applicable government taxes and legal fees associated with the prize.','አሸናፊዎች ከሽልማቱ ጋር የተያያዙ ተፈጻሚ የመንግሥት ግብሮችንና ሕጋዊ ክፍያዎችን ይሸፍናሉ።'),
 text('By accepting a prize, winners agree to allow LowWin to use their name and photograph for promotional and marketing purposes.','ሽልማቱን በመቀበል አሸናፊዎች ሎውዊን ስማቸውንና ፎቶግራፋቸውን ለማስተዋወቂያና ለግብይት ሥራዎች እንዲጠቀም ይስማማሉ።')
];
const fraud=[
 text('Using multiple Telegram accounts to manipulate an auction leads to disqualification and account suspension. Coordination between users to block or manipulate bid numbers is forbidden.','ጨረታን ለማዛባት ብዙ የቴሌግራም መለያዎችን መጠቀም ከጨረታ መሰናበትንና የመለያ እገዳን ያስከትላል። የጨረታ ቁጥሮችን ለመቆጣጠር ወይም ለማዛባት ተጠቃሚዎች ተቀናጅተው መሥራት የተከለከለ ነው።'),
 text('Any attempt to hack, bypass or interfere with the Telegram Bot’s security will result in legal action.','የቴሌግራም ቦቱን ደህንነት ለመስበር፣ ለማለፍ ወይም ለማወክ የሚደረግ ማንኛውም ሙከራ ሕጋዊ እርምጃ ያስከትላል።')
];
const liability=[
 text('LowWin is not responsible for bid delays or failures caused by internet interruptions, Telegram downtime or other technical issues beyond its control.','ከቁጥጥሩ ውጪ በሆኑ የኢንተርኔት መቆራረጥ፣ የቴሌግራም መቋረጥ ወይም ሌሎች ቴክኒካዊ ችግሮች ምክንያት ለሚከሰቱ የጨረታ መዘግየቶች ወይም ውድቀቶች ሎውዊን ተጠያቂ አይሆንም።'),
 text('LowWin reserves the right to modify, suspend or update these terms at any time.','ሎውዊን እነዚህን ደንቦች በማንኛውም ጊዜ የማሻሻል፣ የማገድ ወይም የማዘመን መብቱን ይጠብቃል።')
];
const disputes=[
 text('These terms are governed by the laws of the Federal Democratic Republic of Ethiopia. Complaints or disputes may be submitted through the bot’s Support channel for review within 24 hours.','እነዚህ ደንቦች በኢትዮጵያ ፌዴራላዊ ዲሞክራሲያዊ ሪፐብሊክ ሕጎች ይገዛሉ። ቅሬታዎችን ወይም ክርክሮችን ለግምገማ በቦቱ የድጋፍ መስጫ በኩል በ24 ሰዓታት ውስጥ ማቅረብ ይችላሉ።'),
 text('By using the LowWin Telegram Bot, you agree to these Terms and Conditions.','የሎውዊን ቴሌግራም ቦትን በመጠቀም በእነዚህ ውሎችና ሁኔታዎች መስማማትዎን ያረጋግጣሉ።')
];
export const termsDocument:LegalDocument={
 title:text('LowWin Auction Terms & Conditions','የሎውዊን የጨረታ ሕግጋትና ደንቦች'),
 intro:text('Welcome to LowWin! Win items on our Telegram platform by submitting the lowest unique bid number. Please read these terms carefully. These submission-fee rules apply to auctions displaying this policy. Older auctions retain the payment and refund rules on their auction page.','እንኳን ወደ ሎውዊን በደህና መጡ! በቴሌግራም መድረካችን ዝቅተኛና ብቸኛ የጨረታ ቁጥር በማቅረብ ዕቃዎችን ያሸንፉ። ደንቦቹን በጥንቃቄ ያንብቡ። እነዚህ የማቅረቢያ ክፍያ ደንቦች ይህን ፖሊሲ ለሚያሳዩ ጨረታዎች ይተገበራሉ። የቀድሞ ጨረታዎች በገጻቸው ያሉትን የክፍያና የተመላሽ ደንቦች ይከተላሉ።'),
 sections:[
  {id:'definitions',title:text('Definitions','ትርጓሜዎች'),paragraphs:definitions},
  {id:'eligibility',title:text('Eligibility & participation','ተሳትፎ እና ብቁነት'),paragraphs:eligibility},
  {id:'winning',title:text('How the winner is chosen','አሸናፊው እንዴት ይመረጣል'),paragraphs:winning},
  {id:'payment',title:text('Payment & winner notification','ክፍያ እና የአሸናፊ ማሳወቂያ'),paragraphs:payment},
  {id:'handover',title:text('Prize handover & taxes','የሽልማት ርክክብ እና ግብር'),paragraphs:prize},
  {id:'fraud',title:text('Prohibitions & fraud prevention','ክልከላዎች እና ማጭበርበርን መከላከል'),paragraphs:fraud},
  {id:'liability',title:text('Limitation of liability','የኃላፊነት ገደብ'),paragraphs:liability},
  {id:'disputes',title:text('Governing law & disputes','የሕግ ተገዢነት እና ክርክሮች'),paragraphs:disputes}
 ],
 closing:text('Good luck! LowWin – The Lowest Price, Your Victory!','መልካም ዕድል! ሎውዊን – ዝቅተኛው ዋጋ፣ የእርስዎ ድል!')
};
const faq=(id:string,en:string,am:string,answer:BilingualText):FaqEntry=>({id,question:text(en,am),answer});
export const faqEntries:FaqEntry[]=[
 faq('start','What is LowWin?','ሎውዊን ምንድን ነው?',definitions[0]),
 faq('eligibility','Who can participate?','ማን መሳተፍ ይችላል?',eligibility[0]),
 faq('identity','Will I need identification?','መታወቂያ ያስፈልገኛል?',eligibility[1]),
 faq('number','Do I pay the number I choose?','የመረጥኩትን ቁጥር እንደ ገንዘብ እከፍላለሁ?',payment[0]),
 faq('fee','Is the submission fee always 30 ETB?','የማቅረቢያ ክፍያው ሁልጊዜ 30 ብር ነው?',text('No. It is set separately for each auction. Check the fee before confirming each bid; 30 ETB is only an example.','አይደለም። ለእያንዳንዱ ጨረታ በተለየ ይወሰናል። እያንዳንዱን ጨረታ ከማረጋገጥዎ በፊት ክፍያውን ይመልከቱ፤ 30 ብር ምሳሌ ብቻ ነው።')),
 faq('winner','How is the winner selected?','አሸናፊው እንዴት ይመረጣል?',winning[0]),
 faq('fallback','What if no number is unique?','ብቸኛ ቁጥር ከሌለ ምን ይሆናል?',winning[1]),
 faq('multiple','Can I submit several numbers?','ብዙ ቁጥሮችን ማቅረብ እችላለሁ?',winning[2]),
 faq('minimum','What if only one person enters?','አንድ ሰው ብቻ ከተሳተፈ ምን ይሆናል?',winning[3]),
 faq('refund','Are submission fees refundable?','የማቅረቢያ ክፍያዎች ተመላሽ ናቸው?',payment[1]),
 faq('notification','How will I know if I win, and when must I respond?','ማሸነፌን እንዴት አውቃለሁ? መቼ ምላሽ መስጠት አለብኝ?',payment[2]),
 faq('delivery','When does prize handover begin?','የሽልማት ርክክብ መቼ ይጀምራል?',prize[0]),
 faq('tax','Who pays prize taxes?','የሽልማቱን ግብር ማን ይከፍላል?',prize[1]),
 faq('photo','Can LowWin use my winner photograph?','ሎውዊን የአሸናፊነት ፎቶዬን ሊጠቀም ይችላል?',prize[2]),
 faq('accounts','Can I use multiple accounts or coordinate bids?','ብዙ መለያዎች መጠቀም ወይም ጨረታን ማቀናጀት እችላለሁ?',fraud[0]),
 faq('support','Where do I submit a complaint?','ቅሬታዬን የት አቀርባለሁ?',disputes[0])
];
