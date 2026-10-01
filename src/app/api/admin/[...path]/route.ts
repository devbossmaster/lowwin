import {opsMutation,type OpsAction} from '@/modules/admin/ops';
import {z} from 'zod';
import {readRequestText,RequestBodyError} from '@/lib/request-body';
import {db} from '@/lib/db';
import {adminHeaders,requireAdmin} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {adminRead,adminMutation} from '@/modules/admin/operations';
import {translateCategoryCopy} from '@/modules/admin/translation';
import {requireMutationOrigin,PrivateApiError} from '@/modules/auth/private-api';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:adminHeaders});
function failure(error:unknown){const status=error instanceof AdminError||error instanceof PrivateApiError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?422:503;return json({error:error instanceof AdminError||error instanceof PrivateApiError?error.message:status===422?'Check the supplied fields.':'Admin information is temporarily unavailable.'},status)}
export async function GET(request:Request,{params}:{params:Promise<{path:string[]}>}){try{return json(await adminRead(db,request.headers,(await params).path,new URL(request.url).searchParams))}catch(error){return failure(error)}}
export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}){try{
  requireMutationOrigin(request);const route=(await params).path.join('/');if(!['command','translate-category'].includes(route))throw new AdminError(404,'Admin command not found.');
  let raw:string;try{raw=await readRequestText(request,route==='translate-category'?2000:2900000)}catch(error){if(error instanceof RequestBodyError)throw new AdminError(error.status,error.message);throw error}
  if(route==='translate-category'){await requireAdmin(db,request.headers,{permission:'catalog'});return json(await translateCategoryCopy(JSON.parse(raw)))}
  const body=z.object({action:z.enum(['category','product','media','content','draft','publish','fee','deadline','presentation','deleteDraft','deleteProduct','removeCancelled','cancel','replace','invite','staff','suspend','support','fulfillment','retry','broadcast','testStart','testFinish','testClean']),input:z.unknown()}).strict().parse(JSON.parse(raw));
  return json(['invite','staff','suspend','support','fulfillment','retry','broadcast','testStart','testFinish','testClean'].includes(body.action)?await opsMutation(db,request.headers,body.action as OpsAction,body.input):await adminMutation(db,request.headers,body.action as Parameters<typeof adminMutation>[2],body.input));
}catch(error){return failure(error)}}
