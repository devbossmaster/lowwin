'use client';
import {createContext,useContext,useEffect,useState} from 'react';

export type MiniLanguage='en'|'am';
const copy={
 en:{home:'Home',auctions:'Auctions',winners:'Winners',myBids:'My Bids',wallet:'Wallet',profile:'Profile',available:'Available',loading:'Loading…',signIn:'Sign in',unavailable:'Unavailable',openProfile:'Open your profile',openWallet:'open wallet',funding:'Wallet funding and details',alerts:'Alerts',unread:'unread',browseAuctions:'Browse auctions',language:'Language',startBidding:'Start bidding',categories:'Categories',seeAll:'See all',auction:'auction',auctionsCount:'auctions',pauseCategories:'Pause category scrolling',resumeCategories:'Resume category scrolling',swipeCategories:'Swipe categories',categoriesPrepared:'Categories are being prepared.',featured:'Featured auctions',ending:'Ending within 24 hours',nothingEnding:'Nothing closes within the next 24 hours.',results:'Results & outcomes',noResults:'No public results yet.',questions:'Questions before the first bid?',faqBlurb:'Understand ETB bids, fees, holds and what happens if no bid is unique.',readFaq:'Read the FAQ',privateBids:'Live bid amounts and bidder identities stay private.',homeFurniture:'Home Furniture',vehicles:'Vehicles',accessories:'Accessories',computerOffice:'Computer & Office Equipment',homeFurnishings:'Home Furnishings',jewelry:'Jewelry',watches:'Watches',phones:'Phones',animals:'Animals'},
 am:{home:'መነሻ',auctions:'ጨረታዎች',winners:'አሸናፊዎች',myBids:'የእኔ ጨረታዎች',wallet:'የገንዘብ ቦርሳ',profile:'መገለጫ',available:'ያለ ቀሪ',loading:'በመጫን ላይ…',signIn:'ይግቡ',unavailable:'አይገኝም',openProfile:'መገለጫዎን ይክፈቱ',openWallet:'የገንዘብ ቦርሳዎን ይክፈቱ',funding:'የገንዘብ ቦርሳ ዝርዝር',alerts:'ማሳወቂያዎች',unread:'ያልተነበቡ',browseAuctions:'ጨረታዎችን ይመልከቱ',language:'ቋንቋ',startBidding:'ጨረታ ጀምር',categories:'ምድቦች',seeAll:'ሁሉንም ይመልከቱ',auction:'ጨረታ',auctionsCount:'ጨረታዎች',pauseCategories:'የምድቦችን ማሸብለል አቁም',resumeCategories:'የምድቦችን ማሸብለል ቀጥል',swipeCategories:'ምድቦችን ያሸብልሉ',categoriesPrepared:'ምድቦች በመዘጋጀት ላይ ናቸው።',featured:'ተለይተው የቀረቡ ጨረታዎች',ending:'በ24 ሰዓት ውስጥ የሚያበቁ',nothingEnding:'በሚቀጥሉት 24 ሰዓት ውስጥ የሚያበቃ ጨረታ የለም።',results:'ውጤቶች እና አሸናፊዎች',noResults:'የሕዝብ ውጤት ገና የለም።',questions:'ከመጀመሪያው ጨረታ በፊት ጥያቄ አለዎት?',faqBlurb:'ስለ ETB ጨረታዎች፣ ክፍያዎች፣ የተያዙ መጠኖች እና ልዩ ጨረታ በማይኖርበት ጊዜ የሚሆነውን ይረዱ።',readFaq:'የተደጋጋሚ ጥያቄዎችን ያንብቡ',privateBids:'በሂደት ላይ ያሉ የጨረታ መጠኖች እና የተሳታፊዎች ማንነት የግል ናቸው።',homeFurniture:'የቤት ዕቃዎች',vehicles:'ተሽከርካሪዎች',accessories:'መለዋወጫዎች',computerOffice:'ኮምፒውተር እና የቢሮ ዕቃዎች',homeFurnishings:'የቤት ማስዋቢያዎች',jewelry:'ጌጣጌጦች',watches:'ሰዓቶች',phones:'ስልኮች',animals:'እንስሳት'}
} as const;
export type MiniCopyKey=keyof typeof copy.en;
const MiniLocaleContext=createContext<{language:MiniLanguage;setLanguage:(value:MiniLanguage)=>void;t:(key:MiniCopyKey)=>string}>({language:'en',setLanguage:()=>{},t:key=>copy.en[key]});
export function MiniLocaleProvider({children}:{children:React.ReactNode}){
 const [language,setCurrent]=useState<MiniLanguage>('en');
 useEffect(()=>{try{if(localStorage.getItem('lowwin-language')==='am')setCurrent('am')}catch{}},[]);
 useEffect(()=>{document.documentElement.lang=language;return()=>{document.documentElement.lang='en'}},[language]);
 const setLanguage=(value:MiniLanguage)=>{setCurrent(value);try{localStorage.setItem('lowwin-language',value)}catch{}};
 return <MiniLocaleContext.Provider value={{language,setLanguage,t:key=>copy[language][key]}}>{children}</MiniLocaleContext.Provider>;
}
export const useMiniLocale=()=>useContext(MiniLocaleContext);
export function MiniText({id}:{id:MiniCopyKey}){const {t}=useMiniLocale();return <>{t(id)}</>}
