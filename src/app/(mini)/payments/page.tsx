import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {db} from '@/lib/db';
import {getMiniSession} from '@/modules/auth/mini-access';
import {ChapaPaymentHistory} from '@/components/chapa-payment-history';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function Payments({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,values=[params.checkout,params.checkoutId,params.id].filter(value=>value!==undefined);
 if(process.env.ARIFPAY_SCHEMA_READY==='true'&&values.length===1&&typeof values[0]==='string'&&uuid.test(values[0])){
  const current=await getMiniSession(await headers());
  if(current){
   const checkout=await db.arifPayCheckout.findFirst({where:{id:values[0],userId:current.user.id},select:{id:true,auction:{select:{publicCode:true}}}});
   if(checkout)redirect(`/auctions/${checkout.auction.publicCode}?checkout=${checkout.id}`);
  }
 }
 return <ChapaPaymentHistory fullPage/>;
}
