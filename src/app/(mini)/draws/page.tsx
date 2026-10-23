import Link from 'next/link';
import {Clock3,Trophy} from 'lucide-react';
import {listDraws} from '@/modules/auctions/draws';
import {MiniPhrase} from '@/components/mini-locale';
import {DrawsList} from '@/components/draws-list';
import {OfflineRetry} from '@/components/offline-retry';
import styles from '@/components/account-pages.module.css';

export default async function Draws({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams,tab=params.tab==='upcoming'?'upcoming':'past';
  const number=Number(params.page??1),page=Number.isSafeInteger(number)&&number>0?Math.min(number,1000):1;
  const data=await listDraws(tab,page);
  return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="Draws" am="ውጤቶች"/></h1><p><MiniPhrase en="Final results and what’s coming next." am="የመጨረሻ ውጤቶች እና ቀጣይ ጨረታዎች።"/></p></header><nav className={styles.tabs} aria-label="Draws"><Link href="/draws" aria-current={tab==='past'?'page':undefined}><Trophy size={15} aria-hidden="true"/><MiniPhrase en="Past Draws" am="ያለፉ ጨረታዎች"/></Link><Link href="/draws?tab=upcoming" aria-current={tab==='upcoming'?'page':undefined}><Clock3 size={15} aria-hidden="true"/><MiniPhrase en="Upcoming" am="ቀጣይ"/></Link></nav><DrawsList items={data.items} tab={tab} serverNow={data.serverNow}/>{data.totalPages>1&&<nav className="pagination" aria-label="Draw pages">{page>1&&<Link href={`/draws?tab=${tab}&page=${page-1}`}><MiniPhrase en="Previous" am="ወደ ኋላ"/></Link>}{page<data.totalPages&&<Link href={`/draws?tab=${tab}&page=${page+1}`}><MiniPhrase en="Next page" am="ቀጣይ ገጽ"/></Link>}</nav>}</section></>;
}
