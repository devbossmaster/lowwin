import {notFound,redirect} from 'next/navigation';
import {AuctionDetail} from '@/components/auction-detail';
import {OfflineRetry} from '@/components/offline-retry';
import {getAuction,serverNow} from '@/modules/auctions/catalog';
export default async function AuctionPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{checkout?:string|string[]}>}){
 const {slug}=await params,now=await serverNow(),auction=await getAuction(slug,now);
 if(!auction)notFound();
 if(slug!==auction.code){
  const candidate=(await searchParams).checkout;
  const checkout=typeof candidate==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)?`?checkout=${encodeURIComponent(candidate)}`:'';
  redirect(`/auctions/${auction.code}${checkout}`);
 }
 return <><OfflineRetry/><AuctionDetail auction={auction} serverNow={now.toISOString()}/></>;
}
