'use client';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import styles from './account-pages.module.css';

export function BidPagination({page,totalPages,onPage}:{page:number;totalPages:number;onPage:(page:number)=>void}){
  const {language}=useMiniLocale(),am=language==='am';
  if(totalPages<2)return null;
  const start=Math.max(1,Math.min(page-1,totalPages-3));
  const pages=Array.from({length:Math.min(4,totalPages)},(_,index)=>start+index);
  return <nav className={styles.pagination} aria-label={am?'የጨረታ ገጾች':'Bid pages'}><button type="button" aria-label={am?'የቀድሞ ገጽ':'Previous page'} disabled={page===1} onClick={()=>onPage(page-1)}><ChevronLeft size={20}/></button>{pages.map(number=><button type="button" key={number} aria-label={am?`ገጽ ${number}`:`Page ${number}`} aria-current={page===number?'page':undefined} onClick={()=>onPage(number)}>{number}</button>)}<button type="button" aria-label={am?'ቀጣይ ገጽ':'Next page'} disabled={page===totalPages} onClick={()=>onPage(page+1)}><ChevronRight size={20}/></button></nav>;
}
