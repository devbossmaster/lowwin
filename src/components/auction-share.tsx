'use client';
import {useState} from 'react';
import {Share2} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import styles from './auction-detail.module.css';
export function AuctionShare({title,code}:{title:string;code:string}){
 const notice=useMiniNotice(),[busy,setBusy]=useState(false);
 async function share(){
  setBusy(true);
  try{
   const url=new URL(`/auctions/${code}`,window.location.origin).href;
   if(navigator.share)await navigator.share({title,url});
   else{await navigator.clipboard.writeText(url);notice('Auction link copied.','success')}
  }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notice('Could not share. Please retry.','error')}finally{setBusy(false)}
 }
 return <button type="button" className={styles.share} onClick={()=>void share()} disabled={busy}><Share2 size={18}/><MiniPhrase en="Share" am="ያጋሩ"/></button>;
}
