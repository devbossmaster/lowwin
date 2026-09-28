import {notFound} from 'next/navigation';
import {AuctionDetail} from '@/components/auction-detail';
import {OfflineRetry} from '@/components/offline-retry';
import {getAuction,serverNow} from '@/modules/auctions/catalog';
export default async function AuctionPage({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params,now=await serverNow(),auction=await getAuction(slug,now);
 if(!auction)notFound();
 return <><OfflineRetry/><AuctionDetail auction={auction} serverNow={now.toISOString()}/></>;
}
