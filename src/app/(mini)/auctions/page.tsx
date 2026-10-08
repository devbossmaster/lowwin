import {redirect} from 'next/navigation';
import {auctionBrowseHref,parseBrowseQuery} from '@/modules/auctions/browse-query';

type SearchParams=Record<string,string|string[]|undefined>;

export default async function Auctions({searchParams}:{searchParams:Promise<SearchParams>}){
 const query=parseBrowseQuery(await searchParams);
 redirect(auctionBrowseHref(query));
}
