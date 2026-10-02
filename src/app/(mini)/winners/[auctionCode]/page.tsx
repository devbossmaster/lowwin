import {redirect,notFound} from 'next/navigation';
import {db} from '@/lib/db';
import {getPublicResult} from '@/modules/auctions/results';
export default async function WinnerDetail({params}:{params:Promise<{auctionCode:string}>}){
  const auction=await getPublicResult(db,(await params).auctionCode);
  if(!auction)notFound();
  redirect(`/auctions/${auction.code}`);
}
