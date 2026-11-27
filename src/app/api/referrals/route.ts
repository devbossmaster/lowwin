import {db} from '@/lib/db';
import {privateError,privateHeaders,requireUser} from '@/modules/auth/private-api';
import {getReferralOverview,getReferralPolicy} from '@/modules/referrals/service';

export const runtime='nodejs';

export async function GET(request:Request){
 try{
  const userId=await requireUser(request);
  if(new URL(request.url).searchParams.get('view')==='policy'){
   const {configured,enabled,rewardEtb}=await getReferralPolicy(db);
   return Response.json({configured,enabled,rewardEtb},{headers:privateHeaders});
  }
  return Response.json(await getReferralOverview(db,userId),{headers:privateHeaders});
 }catch(error){return privateError(error)}
}
