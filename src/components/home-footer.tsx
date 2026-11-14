'use client';
import Link from 'next/link';
import {Send} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './home-footer.module.css';

function TikTok(){return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.7 2h-3.4v13.5a3 3 0 1 1-2.6-3V9a6.5 6.5 0 1 0 6 6.5V8.6a8.1 8.1 0 0 0 4.8 1.6V6.8A4.9 4.9 0 0 1 16.7 2Z"/></svg>}
const socials=[{name:'TikTok',url:'https://www.tiktok.com/@lowwinet',Icon:TikTok},{name:'Telegram',url:'https://t.me/lowwin23',Icon:Send}];

/** Merchant-supplied public links; no additional data requests. */
export function HomeFooter(){
 const {language}=useMiniLocale();
 return <footer className={styles.footer} role="contentinfo" aria-label={language==='am'?'የLowwin አገናኞች':'Lowwin footer'}>
  <nav className={styles.socials} aria-label={language==='am'?'ማህበራዊ ገጾቻችን':'Our social pages'}>{socials.map(({name,url,Icon})=><a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Lowwin on ${name}`}><span><Icon size={15} strokeWidth={1.8} aria-hidden="true"/></span></a>)}</nav>
  <p><MiniPhrase en="18+ only. Bid fees are non-refundable. Please bid responsibly." am="ከ18 ዓመት በላይ ብቻ። የማስገቢያ ክፍያ አይመለስም። በኃላፊነት ይሳተፉ።"/></p>
  <p>© {new Date().getUTCFullYear()} Lowwin · <MiniPhrase en="Lowest unique bid wins" am="ዝቅተኛው ልዩ ቁጥር ያሸንፋል"/></p>
  <nav className={styles.legal} aria-label={language==='am'?'ውሎችና ሁኔታዎች':'Terms and conditions'}><Link href="/terms"><MiniPhrase en="Terms & Conditions apply" am="ውሎችና ሁኔታዎች ይተገበራሉ"/></Link></nav>
 </footer>;
}
