import {db} from '@/lib/db';
import {activityCodesSchema,readAuctionActivity} from '@/modules/auctions/activity';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function GET(request:Request){
 const supplied=new URL(request.url).searchParams.get('codes');
 const parsed=activityCodesSchema.safeParse(supplied?.split(',')??[]);
 if(!parsed.success)return Response.json({error:'Invalid auction codes.'},{status:422,headers});
 try{return Response.json({items:await readAuctionActivity(db,parsed.data)},{headers})}
 catch{return Response.json({error:'Auction activity is unavailable.'},{status:503,headers:{...headers,'Retry-After':'2'}})}
}
