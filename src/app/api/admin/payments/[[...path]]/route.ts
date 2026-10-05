import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {PaymentError} from '@/modules/payments/provider';
import {paymentAdminRead,paymentAdminCommand,recordStatement} from '@/modules/payments/admin';
import {requireMutationOrigin,smallJson,PrivateApiError} from '@/modules/auth/private-api';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
function failure(e:unknown,method:'GET'|'POST'){
 if(e instanceof AdminError||e instanceof PaymentError||e instanceof PrivateApiError)return json({error:e.message},e.status);
 if(e instanceof z.ZodError)return json({error:'Check the supplied fields.'},422);
 const traceId=randomUUID(),exception=e&&typeof e==='object'?e as {code?:unknown;errorCode?:unknown;name?:unknown}:{};
 const rawCode=exception.code??exception.errorCode;
 const code=typeof rawCode==='string'&&/^P\d{4}$/.test(rawCode)?rawCode:'UNKNOWN';
 const name=typeof exception.name==='string'&&['PrismaClientInitializationError','PrismaClientKnownRequestError','PrismaClientValidationError','TypeError','RangeError'].includes(exception.name)?exception.name:'Error';
 // Raw errors can contain connection passwords, SQL, or payment evidence.
 console.error(JSON.stringify({event:'payment_admin_error',traceId,method,code,name}));
 return json({error:'Payment operations are unavailable.',traceId},503);
}
export async function GET(r:Request,{params}:{params:Promise<{path?:string[]}>}){try{return json(await paymentAdminRead(db,r.headers,(await params).path??[],new URL(r.url).searchParams))}catch(e){return failure(e,'GET')}}
export async function POST(r:Request){try{requireMutationOrigin(r);const b=z.object({action:z.string(),input:z.unknown()}).strict().parse(await smallJson(r));return json(b.action==='statement'?await recordStatement(db,r.headers,b.input):await paymentAdminCommand(db,r.headers,b.action,b.input))}catch(e){return failure(e,'POST')}}
