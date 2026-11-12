import {db} from '@/lib/db';
import {privateError,privateHeaders,requireUser} from '@/modules/auth/private-api';
import {getOwnCouponCount} from '@/modules/referrals/coupon-count';

export const runtime='nodejs';
export async function GET(request:Request){
 try{return Response.json(await getOwnCouponCount(db,await requireUser(request)),{headers:privateHeaders})}
 catch(error){return privateError(error)}
}
