import {z} from 'zod';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {ChapaError} from '@/modules/payments/chapa-provider';
import {checkChapaAdmin,readChapaAdmin} from '@/modules/admin/chapa';
import {requireMutationOrigin,smallJson,PrivateApiError} from '@/modules/auth/private-api';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
function failure(error:unknown){
 if(error instanceof AdminError||error instanceof PrivateApiError||error instanceof ChapaError)return json({error:error.message,...(error instanceof AdminError&&error.code?{code:error.code}:{})},error.status);
 if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'Check the supplied fields.'},422);
 return json({error:'This Chapa payment could not be checked. Refresh its stored status, then retry using the same payment ID and request key.'},503);
}
export async function GET(request:Request,{params}:{params:Promise<{path?:string[]}>}){
 try{const path=(await params).path??[];if(path.length!==1)return json({error:'Chapa payment task not found.'},404);return json(await readChapaAdmin(db,request.headers,path[0]));}catch(error){return failure(error)}
}
export async function POST(request:Request,{params}:{params:Promise<{path?:string[]}>}){
 try{requireMutationOrigin(request);if(((await params).path??[]).length)return json({error:'Chapa payment task not found.'},404);const body=z.object({action:z.literal('check'),input:z.unknown()}).strict().parse(await smallJson(request));return json(await checkChapaAdmin(db,request.headers,body.input));}catch(error){return failure(error)}
}
