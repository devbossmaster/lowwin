import Link from 'next/link';
import {db} from '@/lib/db';
import {listCompletedWinners} from '@/modules/auctions/results';
import {MiniPhrase} from '@/components/mini-locale';
import {WinnerCards} from '@/components/winner-cards';
import {OfflineRetry} from '@/components/offline-retry';
import styles from '@/components/account-pages.module.css';
export default async function Winners({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,raw=Number(params.page??1),page=Number.isSafeInteger(raw)&&raw>0?Math.min(raw,10000):1;
 const data=await listCompletedWinners(db,page,12);
 return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="Winners" am="አሸናፊዎች"/></h1><p><MiniPhrase en="Confirmed results from completed auctions." am="ከተጠናቀቁ ጨረታዎች የተረጋገጡ ውጤቶች።"/></p></header><WinnerCards items={data.items}/>{data.totalPages>1&&<nav className="pagination" aria-label="Winner pages">{page>1&&<Link href={`/winners?page=${page-1}`}><MiniPhrase en="Previous" am="ወደ ኋላ"/></Link>}{page<data.totalPages&&<Link href={`/winners?page=${page+1}`}><MiniPhrase en="Next" am="ቀጣይ"/></Link>}</nav>}</section></>;
}
