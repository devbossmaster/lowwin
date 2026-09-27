import {z} from 'zod';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {PaymentError} from '@/modules/payments/provider';
import {paymentAdminRead,paymentAdminCommand,recordStatement} from '@/modules/payments/admin';
import {requireMutationOrigin,smallJson,PrivateApiError} from '@/modules/auth/private-api';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
const failure=(e:unknown)=>json({error:e instanceof AdminError||e instanceof PaymentError||e instanceof PrivateApiError?e.message:e instanceof z.ZodError?'Check the supplied fields.':'Payment operations are unavailable.'},e instanceof AdminError||e instanceof PaymentError||e instanceof PrivateApiError?e.status:e instanceof z.ZodError?422:503);
export async function GET(r:Request,{params}:{params:Promise<{path?:string[]}>}){try{return json(await paymentAdminRead(db,r.headers,(await params).path??[],new URL(r.url).searchParams))}catch(e){return failure(e)}}
export async function POST(r:Request){try{requireMutationOrigin(r);const b=z.object({action:z.string(),input:z.unknown()}).strict().parse(await smallJson(r));return json(b.action==='statement'?await recordStatement(db,r.headers,b.input):await paymentAdminCommand(db,r.headers,b.action,b.input))}catch(e){return failure(e)}}
