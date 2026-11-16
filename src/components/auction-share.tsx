'use client';
import {Share2,Send} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import {useTelegram} from './telegram-provider';
import {auctionShareLinks} from '@/lib/auction-share-link';
import styles from './auction-share.module.css';

function useAuctionShare(title:string,code:string){
 const {botUrl}=useTelegram(),notice=useMiniNotice(),{language}=useMiniLocale(),am=language==='am';
 const links=()=>auctionShareLinks({botUrl,code,title,origin:window.location.origin});
 function telegram(){
  try{const url=links().telegram;if(window.Telegram?.WebApp?.openTelegramLink)window.Telegram.WebApp.openTelegramLink(url);else window.open(url,'_blank','noopener,noreferrer')}
  catch{notice(am?'ማጋራት አልተቻለም። እንደገና ይሞክሩ።':'Could not share. Please retry.','error')}
 }
 return {telegram};
}
export function AuctionShare({title,code,iconOnly=false,className=''}:{title:string;code:string;iconOnly?:boolean;className?:string}){
 const share=useAuctionShare(title,code);
 return <button type="button" className={`${styles.share} ${iconOnly?styles.iconOnly:''} ${className}`} onClick={share.telegram} data-auction-share><Share2 size={16} aria-hidden="true"/><span className={iconOnly?'sr-only':undefined}><MiniPhrase en="Share" am="ያጋሩ"/></span></button>;
}
function TikTokIcon(){
 return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.7 2h-3.4v13.5a3 3 0 1 1-2.6-3V9a6.5 6.5 0 1 0 6 6.5V8.6a8.1 8.1 0 0 0 4.8 1.6V6.8A4.9 4.9 0 0 1 16.7 2Z"/></svg>;
}
export function AuctionShareOptions({title,code}:{title:string;code:string}){
 const share=useAuctionShare(title,code);
 return <section className={styles.options} data-auction-share-options><p><MiniPhrase en="Share & follow" am="ያጋሩና ይከተሉ"/></p><div><button type="button" onClick={share.telegram}><span><Send size={18} aria-hidden="true"/></span>Telegram</button><a href="https://www.tiktok.com/@lowwinet" target="_blank" rel="noopener noreferrer"><span><TikTokIcon/></span>TikTok</a></div></section>;
}
