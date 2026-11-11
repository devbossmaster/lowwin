import {z} from 'zod';
import {privateHeaders} from '@/modules/auth/private-api';
export const runtime='nodejs';
// Navigation callback data is untrusted. The owned return flow verifies tx_ref.
export async function GET(request:Request){const id=z.string().uuid().safeParse(new URL(request.url).searchParams.get('checkout')),target=new URL('/payments/chapa/return',process.env.MINI_APP_URL);if(id.success)target.searchParams.set('checkout',id.data);return new Response(null,{status:303,headers:{...privateHeaders,Location:target.href}})}
export async function POST(){return Response.json({status:'verification_required'},{status:202,headers:privateHeaders})}
