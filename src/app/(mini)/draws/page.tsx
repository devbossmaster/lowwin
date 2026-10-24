import {redirect} from 'next/navigation';
/** Preserve old notifications and links; future auctions now belong to Browse. */
export default async function Draws({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;if(params.tab==='upcoming')redirect('/auctions/all?status=upcoming');
 const page=Number(params.page??1);redirect('/winners'+(Number.isSafeInteger(page)&&page>1?`?page=${Math.min(page,10000)}`:''));
}
