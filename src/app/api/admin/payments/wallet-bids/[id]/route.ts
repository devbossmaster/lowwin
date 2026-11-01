import {z} from 'zod';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {readWalletBidPayment} from '@/modules/admin/wallet-bid-payment';

export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{return Response.json(await readWalletBidPayment(db,request.headers,(await params).id),{headers:adminHeaders})}
 catch(error){
  if(error instanceof AdminError)return Response.json({error:error.message,...(error.code?{code:error.code}:{})},{status:error.status,headers:adminHeaders});
  if(error instanceof z.ZodError)return Response.json({error:'Choose a valid bid payment.'},{status:422,headers:adminHeaders});
  return Response.json({error:'This wallet payment is temporarily unavailable. Refresh its recorded details.'},{status:503,headers:adminHeaders});
 }
}
