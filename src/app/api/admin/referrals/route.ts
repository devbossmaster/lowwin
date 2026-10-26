import {z} from 'zod';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {readReferralAdmin,saveReferralAdmin} from '@/modules/admin/referrals';
import {requireMutationOrigin,smallJson,PrivateApiError} from '@/modules/auth/private-api';

export const runtime='nodejs';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
function failure(error:unknown){
 if(error instanceof AdminError||error instanceof PrivateApiError)return json({error:error.message,...(error instanceof AdminError&&error.code?{code:error.code}:{})},error.status);
 if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'Use a discount from 5–15%, a validity from 15–30 days, and a reason.'},422);
 return json({error:'Referral settings could not be loaded. Try again.'},503);
}
export async function GET(request:Request){try{return json(await readReferralAdmin(db,request.headers))}catch(error){return failure(error)}}
export async function POST(request:Request){
 try{
  requireMutationOrigin(request);
  const body=z.object({action:z.literal('save-policy'),input:z.unknown()}).strict().parse(await smallJson(request));
  return json(await saveReferralAdmin(db,request.headers,body.input));
 }catch(error){return failure(error)}
}
