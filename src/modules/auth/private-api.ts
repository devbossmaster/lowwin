import { z } from 'zod';
import {readRequestText,RequestBodyError} from '@/lib/request-body';
import {db} from '@/lib/db';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {getMiniSession} from './mini-access';
export const privateHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'};
export class PrivateApiError extends Error {constructor(public status:number,message:string){super(message)}}
export async function requireUser(request:Request) {
  const session=await getMiniSession(request.headers);
  if(!session)throw new PrivateApiError(401,'Sign in through Telegram.');
  await limitUserMutation(request,session.user.id);
  return session.user.id;
}
export async function limitUserMutation(request:Request,userId:string){
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!await allowIdentityRequest(db,'mutation',userId,60))throw new PrivateApiError(429,'Too many requests. Wait a minute and retry.');
}
export function requireMutationOrigin(request:Request) {
  if(!process.env.BETTER_AUTH_URL||request.headers.get('origin')!==new URL(process.env.BETTER_AUTH_URL).origin)throw new PrivateApiError(403,'Request origin is not allowed.');
}
export async function smallJson(request:Request):Promise<unknown> {
  let body:string;
  try {body=await readRequestText(request,4096)} catch(error) {if(error instanceof RequestBodyError)throw new PrivateApiError(error.status,error.message);throw error}
  return JSON.parse(body);
}
export function privateError(error:unknown) {
  const status=error instanceof PrivateApiError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?422:503;
  return Response.json({error:error instanceof PrivateApiError?error.message:status===422?'Check the supplied fields.':'This information is temporarily unavailable.'},{status,headers:privateHeaders});
}
