import {redirect} from 'next/navigation';
import {auctionBrowseHref,parseBrowseQuery} from '@/modules/auctions/browse-query';
import {requireCustomerPage} from '@/modules/auth/customer-page';

type SearchParams=Record<string,string|string[]|undefined>;

export default async function Auctions({searchParams}:{searchParams:Promise<SearchParams>}){
 await requireCustomerPage('/auctions');
 const query=parseBrowseQuery(await searchParams);
 redirect(auctionBrowseHref(query));
}
