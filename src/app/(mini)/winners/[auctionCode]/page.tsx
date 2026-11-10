import {notFound} from 'next/navigation';
import {db} from '@/lib/db';
import {getPublicResult} from '@/modules/auctions/results';
import {WinnerResultRoute} from '@/components/winner-result-route';
import styles from '@/components/account-pages.module.css';
export default async function WinnerDetail({params}:{params:Promise<{auctionCode:string}>}){
  const auction=await getPublicResult(db,(await params).auctionCode);
  if(!auction)notFound();
  return <section className={styles.page}><WinnerResultRoute key={auction.code} auction={auction}/></section>;
}
