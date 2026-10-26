import {z} from 'zod';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {ArifPayError} from '@/modules/payments/arifpay-provider';
import {checkArifPayAdmin,readArifPayAdmin} from '@/modules/admin/arifpay';
import {requireMutationOrigin,smallJson,PrivateApiError} from '@/modules/auth/private-api';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
function failure(error:unknown){
 if(error instanceof AdminError||error instanceof PrivateApiError||error instanceof ArifPayError)return json({error:error.message,...(error instanceof AdminError&&error.code?{code:error.code}:{})},error.status);
 if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'Check the supplied fields.'},422);
 return json({error:'Bid payments could not be loaded. Try again.'},503);
}
export async function GET(r:Request,{params}:{params:Promise<{path?:string[]}>}){try{const path=(await params).path??[];if(path.length>1)return json({error:'Payment task not found.'},404);return json(await readArifPayAdmin(db,r.headers,path[0],new URL(r.url).searchParams))}catch(e){return failure(e)}}
export async function POST(r:Request){try{requireMutationOrigin(r);const body=z.object({action:z.literal('check'),input:z.unknown()}).strict().parse(await smallJson(r));return json(await checkArifPayAdmin(db,r.headers,body.input))}catch(e){return failure(e)}}
