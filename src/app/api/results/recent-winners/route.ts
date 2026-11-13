import {db} from '@/lib/db';
import {listCompletedWinners} from '@/modules/auctions/results';
import {stagingDemoEnabled} from '@/modules/auctions/staging-demo';
import {recentWinnerPreview} from '@/lib/catalog-preview';
export const runtime='nodejs';
/** One bounded Home announcement projection, never winner identities or breakdowns. */
export async function GET(){
 try{
  const data=await listCompletedWinners(db,1,12);
  return Response.json({...data,items:data.items.map(recentWinnerPreview),allowDemo:stagingDemoEnabled()},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Recent winners are temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}})}
}
