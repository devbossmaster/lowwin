import {z} from 'zod';
import {privateHeaders} from '@/modules/auth/private-api';
export const runtime='nodejs';
// Chapa's optional callback authentication is not documented as a webhook.
// It is only navigation guidance. It never reads or changes a payment/wallet.
export async function GET(request:Request){const target=new URL('/payments/chapa/return',process.env.MINI_APP_URL),id=z.string().uuid().safeParse(new URL(request.url).searchParams.get('checkout'));if(id.success)target.searchParams.set('checkout',id.data);return new Response(null,{status:303,headers:{...privateHeaders,Location:target.href}})}
export async function POST(){return Response.json({status:'verification_required'},{status:202,headers:privateHeaders})}
