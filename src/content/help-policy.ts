import type {BilingualText,LegalDocument,FaqEntry} from './help';
const text=(en:string,am:string):BilingualText=>({en,am});
const definitions=[
 text('LowWin is the digital auction platform operating through a Telegram Bot and/or mobile application.','ሎውዊን በቴሌግራም ቦት እና/ወይም በሞባይል መተግበሪያ የሚሠራ ዲጂታል የጨረታ መድረክ ነው።'),
 text("Bid number: Your chosen number is not money held or charged, even if it wins. A unique number belongs to exactly one eligible participant; the lowest such number wins.","የጨረታ ቁጥር፦ የመረጡት ቁጥር ገንዘብ አይደለም፤ ቢያሸንፍም አይያዝም ወይም አይቀነስም። ብቸኛ ቁጥር ማለት አንድ ብቁ ተሳታፊ ብቻ የመረጠው ነው፤ ዝቅተኛው ብቸኛ ቁጥር ያሸንፋል።"),
 text("Submission fee: The fee shown before confirmation for each accepted bid. If the auction is cancelled, actual paid fees return automatically to your Lowwin wallet.","የማቅረቢያ ክፍያ፦ እያንዳንዱን ጨረታ ከማረጋገጥዎ በፊት የሚታየው ክፍያ ነው። ጨረታው ከተሰረዘ፣ በእውነት የተከፈሉ ክፍያዎች በራስ ሰር ወደ ሎውዊን ዋሌትዎ ይመለሳሉ።")
];
const eligibility=[
 text('Participants must be 18 or older and use only one Telegram account per person. Users must provide accurate and truthful personal information.','ተሳታፊዎች 18 ዓመት ወይም ከዚያ በላይ መሆን፣ በአንድ ሰው አንድ የቴሌግራም መለያ ብቻ መጠቀምና ትክክለኛ እውነተኛ የግል መረጃ መስጠት አለባቸው።'),
 text('Winners must provide valid identification before receiving a prize.','አሸናፊዎች ሽልማታቸውን ከመቀበላቸው በፊት ትክክለኛ መታወቂያ ማቅረብ አለባቸው።')
];
const winning=[
 text('The lowest number submitted by exactly one participant wins. A number submitted by two or more participants is not unique. For example, if two people choose 1.00 and one chooses 2.00, the 2.00 entry wins.','አንድ ተሳታፊ ብቻ ካቀረባቸው ቁጥሮች ዝቅተኛው ያሸንፋል። ሁለት ወይም ከዚያ በላይ ሰዎች ያቀረቡት ቁጥር ብቸኛ አይደለም። ለምሳሌ፣ ሁለት ሰዎች 1.00 እና አንድ ሰው 2.00 ከመረጡ፣ 2.00 ያቀረበው ያሸንፋል።'),
 text("If no eligible accepted number is unique at the authoritative deadline, the auction is cancelled with no winner. A repeated number never wins, regardless of submission order. Actual paid fees return automatically to participants’ wallets.","በትክክለኛው መዝጊያ ጊዜ ብቸኛ ብቁ የተቀበለ ቁጥር ከሌለ፣ ጨረታው ያለ አሸናፊ ይሰረዛል። የተደገመ ቁጥር መቼም አያሸንፍም፤ የማቅረቢያ ቅደም ተከተል ይህን አይለውጥም። በእውነት የተከፈሉ ክፍያዎች በራስ ሰር ወደ ተሳታፊዎች ዋሌት ይመለሳሉ።"),
 text('Choose a number from 1.00 with at most two decimals and no configured maximum. Up to 100 different numbers per participant are allowed. Consecutive numbers are allowed; do not repeat your own number.','ከ1.00 ጀምሮ እስከ ሁለት የአስርዮሽ ቦታዎች ያለው ቁጥር ይምረጡ፤ የተወሰነ ከፍተኛ ቁጥር የለም። በአንድ ተሳታፊ እስከ 100 የተለያዩ ቁጥሮች ይፈቀዳሉ። ተከታታይ ቁጥሮች ይፈቀዳሉ፤ የራስዎን ቁጥር አይድገሙ።'),
 text("At least two eligible participants must have accepted bids by the deadline. Otherwise the auction is cancelled with no prize, and actual paid submission fees return automatically to their wallets.","እስከ መዝጊያ ሰዓቱ ጨረታቸው የተቀበለላቸው ቢያንስ ሁለት ብቁ ተሳታፊዎች ያስፈልጋሉ። ካልተሟላ ጨረታው ያለ ሽልማት ይሰረዛል፤ በእውነት የተከፈሉ የማቅረቢያ ክፍያዎች በራስ ሰር ወደ ዋሌታቸው ይመለሳሉ።")
];
const payment=[
 text('Fund your wallet through Telebirr or another payment method offered in the app. For each accepted bid, pay only the displayed submission fee. Choosing 3.60 with a 30 ETB fee costs 30 ETB total, not 33.60 ETB. Winning adds no charge for the chosen number.','በቴሌብር ወይም በመተግበሪያው በሚቀርብ ሌላ የክፍያ ዘዴ ቦርሳዎን ይሙሉ። ለእያንዳንዱ የተቀበለ ጨረታ የታየውን የማቅረቢያ ክፍያ ብቻ ይከፍላሉ። 3.60ን መርጠው ክፍያው 30 ብር ከሆነ ጠቅላላ ክፍያው 30 ብር ነው፤ 33.60 ብር አይደለም። ማሸነፍ ለመረጡት ቁጥር ተጨማሪ ክፍያ አያስከትልም።'),
 text("On cancellation for any reason, actual net submission fees paid for accepted bids return automatically to your wallet. Cash payments return as cash; bonus-funded amounts return as bonus with their original expiry. Original receipts remain accurate. Rejected bids are not charged. Check Transactions for committed refund entries; a pending refund is not a completed credit.","ጨረታ በማንኛውም ምክንያት ሲሰረዝ፣ ለተቀበሉ ጨረታዎች በእውነት የተከፈሉ የተጣሩ ክፍያዎች በራስ ሰር ወደ ዋሌትዎ ይመለሳሉ። ጥሬ ገንዘብ እንደ ጥሬ ገንዘብ፣ በጉርሻ የተከፈለው በቀድሞው የማብቂያ ጊዜ እንደ ጉርሻ ይመለሳል። የመጀመሪያ ደረሰኞች ይጠበቃሉ። ውድቅ ጨረታዎች አይከፈሉም። የተጠናቀቁ ተመላሾችን በግብይቶች ይመልከቱ፤ በሂደት ያለ ተመላሽ የተጠናቀቀ ክሬዲት አይደለም።"),
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
 text('These terms are governed by the laws of the Federal Democratic Republic of Ethiopia. Complaints or disputes may be submitted through @lowwinsupport on Telegram for review within 24 hours.','እነዚህ ደንቦች በኢትዮጵያ ፌዴራላዊ ዲሞክራሲያዊ ሪፐብሊክ ሕጎች ይገዛሉ። ቅሬታዎችን ወይም ክርክሮችን ለግምገማ በቴሌግራም @lowwinsupport በኩል በ24 ሰዓታት ውስጥ ማቅረብ ይችላሉ።'),
 text('By using the LowWin Telegram Bot, you agree to these Terms and Conditions.','የሎውዊን ቴሌግራም ቦትን በመጠቀም በእነዚህ ውሎችና ሁኔታዎች መስማማትዎን ያረጋግጣሉ።')
];
export const termsDocument:LegalDocument={
 title:text('LowWin Auction Terms & Conditions','የሎውዊን የጨረታ ሕግጋትና ደንቦች'),
 intro:text('Welcome to LowWin! Win items on our Telegram platform by submitting the lowest unique bid number. Please read these terms carefully. These submission-fee rules apply to auctions displaying this policy. Completed historical auctions retain their original published rules. New and explicitly transitioned unsettled auctions use lowest-unique-v5.','እንኳን ወደ ሎውዊን በደህና መጡ! በቴሌግራም መድረካችን ዝቅተኛና ብቸኛ የጨረታ ቁጥር በማቅረብ ዕቃዎችን ያሸንፉ። ደንቦቹን በጥንቃቄ ያንብቡ። እነዚህ የማቅረቢያ ክፍያ ደንቦች ይህን ፖሊሲ ለሚያሳዩ ጨረታዎች ይተገበራሉ። የተጠናቀቁ ታሪካዊ ጨረታዎች የቀድሞ ደንቦቻቸውን ይጠብቃሉ። አዲስና በግልጽ ሽግግር የተሻሻሉ ያልተጠናቀቁ ጨረታዎች lowest-unique-v5ን ይከተላሉ።'),
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
