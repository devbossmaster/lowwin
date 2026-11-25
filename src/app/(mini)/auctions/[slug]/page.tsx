import {notFound,redirect} from 'next/navigation';
import {AuctionDetail} from '@/components/auction-detail';
import {OfflineRetry} from '@/components/offline-retry';
import {getAuction,serverNow} from '@/modules/auctions/catalog';
import {catalogProductPreview} from '@/lib/catalog-preview';
import {chapaUuid} from '@/lib/chapa-client';
import {requireCustomerPage} from '@/modules/auth/customer-page';
export default async function AuctionPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{checkout?:string|string[];chapa?:string|string[]}>}){
 const [{slug},values]=await Promise.all([params,searchParams]);
 if(slug==='all')notFound();
 const query=new URLSearchParams();
 for(const name of ['checkout','chapa'] as const){
  const value=values[name];
  if(typeof value==='string'&&chapaUuid.test(value))query.set(name,value);
 }
 const suffix=query.size?'?'+query:'';
 await requireCustomerPage(`/auctions/${encodeURIComponent(slug)}${suffix}`);
 const now=await serverNow(),auction=await getAuction(slug,now);
 if(!auction)notFound();
 const publishedResult=(auction.status==='closed'||auction.status==='cancelled')&&!!auction.result;
 // The authenticated checkout return still needs its original payment surface.
 if(publishedResult&&!query.size)redirect(`/winners/${auction.code}`);
 if(slug!==auction.code)redirect(`/auctions/${auction.code}${suffix}`);
 return <><OfflineRetry/><AuctionDetail auction={catalogProductPreview(auction)} serverNow={now.toISOString()} publishedResult={publishedResult}/></>;
}
