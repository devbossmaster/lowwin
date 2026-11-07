'use client';
import {useState} from 'react';
import {Share2} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import styles from './auction-detail.module.css';
export function AuctionShare({title,code,iconOnly=false}:{title:string;code:string;iconOnly?:boolean}){
 const notice=useMiniNotice(),[busy,setBusy]=useState(false);
 async function share(){
  setBusy(true);
  try{
   const url=new URL(`/auctions/${code}`,window.location.origin).href;
   if(navigator.share)await navigator.share({title,url});
   else{await navigator.clipboard.writeText(url);notice('Auction link copied.','success')}
  }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notice('Could not share. Please retry.','error')}finally{setBusy(false)}
 }
 return <button type="button" className={`${styles.share} ${iconOnly?styles.shareIcon:''}`} onClick={()=>void share()} disabled={busy}><Share2 size={18} aria-hidden="true"/><span className={iconOnly?'sr-only':undefined}><MiniPhrase en="Share" am="ያጋሩ"/></span></button>;
}
