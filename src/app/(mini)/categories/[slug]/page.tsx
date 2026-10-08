import {notFound,redirect} from 'next/navigation';
import {auctionBrowseHref,parseBrowseQuery} from '@/modules/auctions/browse-query';
import {getCategory,serverNow} from '@/modules/auctions/catalog';

export default async function CategoryPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params,now=await serverNow(),category=await getCategory(slug,now);if(!category)notFound();
 const query=parseBrowseQuery(await searchParams);
 redirect(auctionBrowseHref(query,{category:slug}));
}
