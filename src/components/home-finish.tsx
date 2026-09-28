import Link from 'next/link';
import {ArrowRight,Gavel,MessageCircleMore,ShieldCheck,Smartphone,Trophy} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import styles from './home-finish.module.css';

const steps=[
  {number:'01',icon:Smartphone,titleEn:'Verify your contact',titleAm:'የስልክ ቁጥርዎን ያረጋግጡ',bodyEn:'Share your own phone contact in the private Telegram bot to open your account.',bodyAm:'መለያዎን ለመክፈት የራስዎን ስልክ ቁጥር በግል Telegram ቦት ያጋሩ።'},
  {number:'02',icon:Gavel,titleEn:'Choose an auction',titleAm:'ጨረታ ይምረጡ',bodyEn:'Check the item, entry fee, allowed ETB range and closing time before bidding.',bodyAm:'ከመጫረትዎ በፊት ዕቃውን፣ የመግቢያ ክፍያውን፣ የETB መጠን እና የመዝጊያ ጊዜውን ይመልከቱ።'},
  {number:'03',icon:Trophy,titleEn:'Bid low to win',titleAm:'በዝቅተኛ ጨረታ ያሸንፉ',bodyEn:'The smallest whole-ETB amount submitted by exactly one person wins after the auction closes.',bodyAm:'ጨረታው ሲዘጋ በአንድ ሰው ብቻ የቀረበው ዝቅተኛው ሙሉ ETB መጠን ያሸንፋል።'},
];
const feedback=[
  {name:'Ermi',comment:'The steps are clear and easy to follow.',commentAm:'ደረጃዎቹ ግልጽ እና ለመከተል ቀላል ናቸው።'},
  {name:'Nati',comment:'Clean design—finding an auction feels quick.',commentAm:'ንጹህ ንድፍ ነው፤ ጨረታ ማግኘት ፈጣን ይመስላል።'},
  {name:'Helen',comment:'The bid explanation is simple and helpful.',commentAm:'የጨረታው ማብራሪያ ቀላል እና ጠቃሚ ነው።'},
];

export function HomeFinish(){return <>
  <section className={styles.how} aria-labelledby="how-lowwin-works"><div className={styles.heading}><span><ShieldCheck size={17}/> <MiniPhrase en="Simple and transparent" am="ቀላል እና ግልጽ"/></span><h2 id="how-lowwin-works"><MiniPhrase en="How it works" am="እንዴት ይሰራል?"/></h2><p><MiniPhrase en="Three clear steps from Telegram verification to a settled result." am="ከTelegram ማረጋገጫ እስከ የመጨረሻ ውጤት ድረስ ሶስት ግልጽ ደረጃዎች።"/></p></div><ol>{steps.map(({number,icon:Icon,titleEn,titleAm,bodyEn,bodyAm})=><li key={number}><span className={styles.stepNumber}>{number}</span><div className={styles.illustration}><span/><span/><Icon size={58} strokeWidth={1.55}/></div><h3><MiniPhrase en={titleEn} am={titleAm}/></h3><p><MiniPhrase en={bodyEn} am={bodyAm}/></p></li>)}</ol><Link href="/faq" className={styles.howAction}><MiniPhrase en="Read the full rules" am="ሙሉ ደንቦቹን ያንብቡ"/> <ArrowRight size={17}/></Link></section>
  <section className={styles.feedback} aria-labelledby="demo-feedback"><div className={styles.heading}><span><MessageCircleMore size={17}/> DEMO feedback</span><h2 id="demo-feedback"><MiniPhrase en="A friendly first impression" am="ቀላል እና ደስ የሚል ተሞክሮ"/></h2><p><MiniPhrase en="Sample comments for this UI preview. These are not real customer reviews." am="ለዚህ UI ማሳያ የተጻፉ የናሙና አስተያየቶች ናቸው፤ የእውነተኛ ደንበኞች ግምገማ አይደሉም።"/></p></div><div className={styles.feedbackRow}>{feedback.map(({name,comment,commentAm})=><article key={name}><div className={styles.quote}>“</div><p><MiniPhrase en={comment} am={commentAm}/></p><footer><span aria-hidden="true">{name[0]}</span><strong>{name}</strong><small>UI preview</small></footer></article>)}</div></section>
  </>}
