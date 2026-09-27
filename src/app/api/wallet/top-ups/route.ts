import {getMiniSession} from '@/modules/auth/mini-access';
import {db} from '@/lib/db';
import {privateHeaders,requireUser,requireMutationOrigin,smallJson,privateError} from '@/modules/auth/private-api';
import {PaymentError} from '@/modules/payments/provider';
import {createIntent,fundingOptions,listOwnTopups,verifyIntent} from '@/modules/payments/service';
export const dynamic='force-dynamic';
function error(e:unknown){return e instanceof PaymentError?Response.json({error:e.message},{status:e.status,headers:privateHeaders}):privateError(e)}
export async function GET(r:Request){try{const user=await requireUser(r),page=Math.max(1,Math.min(100000,Number(new URL(r.url).searchParams.get('page'))||1));return Response.json({options:await fundingOptions(db),...await listOwnTopups(db,user,Math.floor(page))},{headers:privateHeaders})}catch(e){return error(e)}}
export async function POST(r:Request){try{requireMutationOrigin(r);const user=await requireUser(r),raw=await smallJson(r) as {action?:string;input?:unknown};if(!raw||Object.keys(raw).some(k=>!['action','input'].includes(k)))throw new PaymentError(422,'Invalid request.');const receipt=raw.action==='create'?await createIntent(db,user,raw.input):raw.action==='verify'?await verifyIntent(db,user,raw.input,undefined,async tx=>{if((await getMiniSession(r.headers,tx))?.user.id!==user)throw new PaymentError(401,'Sign in again.')}):null;if(!receipt)throw new PaymentError(422,'Unknown funding action.');return Response.json(receipt,{headers:privateHeaders})}catch(e){return error(e)}}
