import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/db';
import {smallJson,privateHeaders} from '@/modules/auth/private-api';
import {arifPayAvailability} from '@/modules/payments/arifpay-provider';
import {verifyArifPayCheckout} from '@/modules/payments/arifpay';
export const runtime='nodejs';
const callback=z.object({nonce:z.string().min(1).max(256)});
export async function POST(request:Request){
 const token=new URL(request.url).searchParams.get('token')??'',expected=process.env.ARIFPAY_WEBHOOK_TOKEN??'';
 // Merchant callback URL secret is an additional abuse guard, not provider proof.
 if(!arifPayAvailability().recoveryEnabled||!expected||Buffer.byteLength(token)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return Response.json({accepted:false},{status:401,headers:privateHeaders});
 try{
  const body=callback.parse(await smallJson(request));
  const order=await db.arifPayCheckout.findUnique({where:{nonce:body.nonce},select:{id:true}});
  if(order)await verifyArifPayCheckout(db,order.id);
  return Response.json({accepted:true},{headers:privateHeaders});
 }catch{return Response.json({accepted:false},{status:503,headers:privateHeaders})}
}
