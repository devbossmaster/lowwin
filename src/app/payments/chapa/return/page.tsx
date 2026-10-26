import type {Metadata} from 'next';
import {ChapaReturn} from '@/components/chapa-return';
export const metadata:Metadata={title:'Payment status',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
export default async function ChapaPaymentReturn({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const value=(await searchParams).checkout,id=typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;
 return <ChapaReturn id={id}/>;
}
