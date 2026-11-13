import {notFound} from 'next/navigation';
import {db} from '@/lib/db';
import {getPublicResult} from '@/modules/auctions/results';
import {requireCustomerPage} from '@/modules/auth/customer-page';
import {WinnerResultRoute} from '@/components/winner-result-route';
import styles from '@/components/account-pages.module.css';
export default async function WinnerDetail({params}:{params:Promise<{auctionCode:string}>}){
  const {auctionCode}=await params;
  await requireCustomerPage('/winners/'+encodeURIComponent(auctionCode));
  const auction=await getPublicResult(db,auctionCode);
  if(!auction)notFound();
  return <section className={styles.page}><WinnerResultRoute key={auction.code} auction={auction}/></section>;
}
