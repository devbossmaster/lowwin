import {opsMutation,type OpsAction} from '@/modules/admin/ops';
import {z} from 'zod';
import {readRequestText,RequestBodyError} from '@/lib/request-body';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {adminRead,adminMutation} from '@/modules/admin/operations';
import {requireMutationOrigin,PrivateApiError} from '@/modules/auth/private-api';
import {randomUUID} from 'node:crypto';
import {databaseErrorSummary} from '@/lib/database-error';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
function failure(error:unknown,method:'GET'|'POST',action?:string){
 if(error instanceof AdminError||error instanceof PrivateApiError)return json({...(error instanceof AdminError&&error.code?{code:error.code}:{}),error:error.message},error.status);
 if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'Check the supplied fields.'},422);
 const traceId=randomUUID(),{code,kind}=databaseErrorSummary(error);
 // Never log messages, SQL, uploaded bytes, broadcast text or request headers.
 console.error(JSON.stringify({event:'admin_request_error',traceId,method,...(action?{action}:{}),code,kind}));
 if(code==='P2021'||code==='P2022')return json({code:'ADMIN_SCHEMA_NOT_READY',error:'The running admin database needs an update. Check its connection and applied migrations.',traceId},503);
 if(code==='P2028'||code==='P2024')return json({code:'ADMIN_REQUEST_TIMEOUT',error:'The admin request timed out. Check its current status before retrying.',traceId},503);
 return json({error:'Admin information is temporarily unavailable.',traceId},503);
}
export async function GET(request:Request,{params}:{params:Promise<{path:string[]}>}){try{return json(await adminRead(db,request.headers,(await params).path,new URL(request.url).searchParams))}catch(error){return failure(error,'GET')}}
export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}){let action:string|undefined;try{
  requireMutationOrigin(request);if((await params).path.join('/')!=='command')throw new AdminError(404,'Admin command not found.');
  let raw:string;try{raw=await readRequestText(request,2900000)}catch(error){if(error instanceof RequestBodyError)throw new AdminError(error.status,error.message);throw error}
  const body=z.object({action:z.enum(['category','product','media','draft','publish','fee','deadline','presentation','deleteDraft','deleteProduct','removeCancelled','cancel','replace','suspend','deliveryDone','resultPublish','winnerPhoto','broadcastStop','fulfillment','retry','broadcast']),input:z.unknown()}).strict().parse(JSON.parse(raw));
  action=body.action;
  return json(['suspend','deliveryDone','resultPublish','winnerPhoto','broadcastStop','fulfillment','retry','broadcast'].includes(body.action)?await opsMutation(db,request.headers,body.action as OpsAction,body.input):await adminMutation(db,request.headers,body.action as Parameters<typeof adminMutation>[2],body.input));
}catch(error){return failure(error,'POST',action)}}
