import {z} from 'zod';
import {db} from '@/lib/db';
import {listCompletedWinners} from '@/modules/auctions/results';
import {stagingDemoEnabled} from '@/modules/auctions/staging-demo';
import {PrivateApiError,privateError,privateHeaders,requireUser} from '@/modules/auth/private-api';

export const runtime='nodejs';
const querySchema=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).strict();
export async function GET(request:Request){
 try{
  await requireUser(request);
  const params=new URL(request.url).searchParams;
  if(params.getAll('page').length>1)throw new PrivateApiError(422,'Choose one result page.');
  const {page}=querySchema.parse(Object.fromEntries(params));
  const data=await listCompletedWinners(db,page,12);
  return Response.json({...data,allowDemo:stagingDemoEnabled()},{headers:privateHeaders});
 }catch(error){return privateError(error)}
}
