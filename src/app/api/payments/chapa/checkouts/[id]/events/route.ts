import {db} from '@/lib/db';
import {getMiniSession} from '@/modules/auth/mini-access';
import {PrivateApiError} from '@/modules/auth/private-api';
import {getChapaCheckout} from '@/modules/payments/chapa';
import {subscribeChapaCommitted} from '@/modules/payments/chapa-committed';
import {createChapaEventStream,chapaEventStreamHeaders} from '@/modules/payments/chapa-event-stream';
import {chapaHttpError} from '@/modules/payments/chapa-http';

export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const session=await getMiniSession(request.headers);
  if(!session)throw new PrivateApiError(401,'Sign in through Telegram.');
  const id=(await params).id,initial=await getChapaCheckout(db,session.user.id,id);
  if(session.session.expiresAt.getTime()<=Date.now())throw new PrivateApiError(401,'Sign in through Telegram.');
  const stream=createChapaEventStream({
   initial,expiresAt:session.session.expiresAt.getTime(),signal:request.signal,
   authorized:async()=>{
    const current=await getMiniSession(request.headers);
    return !!current&&current.user.id===session.user.id&&current.session.id===session.session.id;
   },
   read:()=>getChapaCheckout(db,session.user.id,id),
   subscribe:notify=>subscribeChapaCommitted(id,notify),
  });
  return new Response(stream,{headers:chapaEventStreamHeaders});
 }catch(error){return chapaHttpError(error)}
}
