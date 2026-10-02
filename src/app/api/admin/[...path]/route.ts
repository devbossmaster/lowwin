import {opsMutation,type OpsAction} from '@/modules/admin/ops';
import {z} from 'zod';
import {readRequestText,RequestBodyError} from '@/lib/request-body';
import {db} from '@/lib/db';
import {adminHeaders} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {adminRead,adminMutation} from '@/modules/admin/operations';
import {requireMutationOrigin,PrivateApiError} from '@/modules/auth/private-api';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
function failure(error:unknown){const status=error instanceof AdminError||error instanceof PrivateApiError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?422:503;return json({error:error instanceof AdminError||error instanceof PrivateApiError?error.message:status===422?'Check the supplied fields.':'Admin information is temporarily unavailable.'},status)}
export async function GET(request:Request,{params}:{params:Promise<{path:string[]}>}){try{return json(await adminRead(db,request.headers,(await params).path,new URL(request.url).searchParams))}catch(error){return failure(error)}}
export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}){try{
  requireMutationOrigin(request);if((await params).path.join('/')!=='command')throw new AdminError(404,'Admin command not found.');
  let raw:string;try{raw=await readRequestText(request,2900000)}catch(error){if(error instanceof RequestBodyError)throw new AdminError(error.status,error.message);throw error}
  const body=z.object({action:z.enum(['category','product','media','content','draft','publish','fee','deadline','presentation','deleteDraft','deleteProduct','removeCancelled','cancel','replace','invite','staff','suspend','support','supportWithdraw','deliveryDone','broadcastStop','fulfillment','retry','broadcast','testStart','testFinish','testClean']),input:z.unknown()}).strict().parse(JSON.parse(raw));
  return json(['invite','staff','suspend','support','supportWithdraw','deliveryDone','broadcastStop','fulfillment','retry','broadcast','testStart','testFinish','testClean'].includes(body.action)?await opsMutation(db,request.headers,body.action as OpsAction,body.input):await adminMutation(db,request.headers,body.action as Parameters<typeof adminMutation>[2],body.input));
}catch(error){return failure(error)}}
