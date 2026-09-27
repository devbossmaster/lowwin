import { z } from 'zod';
import {getMiniSession} from './mini-access';
export const privateHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'};
export class PrivateApiError extends Error {constructor(public status:number,message:string){super(message)}}
export async function requireUser(request:Request) {
  const session=await getMiniSession(request.headers);
  if(!session)throw new PrivateApiError(401,'Sign in through Telegram.');
  return session.user.id;
}
export function requireMutationOrigin(request:Request) {
  if(!process.env.BETTER_AUTH_URL||request.headers.get('origin')!==new URL(process.env.BETTER_AUTH_URL).origin)throw new PrivateApiError(403,'Request origin is not allowed.');
}
export async function smallJson(request:Request):Promise<unknown> {
  const body=await request.text();
  if(body.length>4096)throw new PrivateApiError(413,'Request is too large.');
  return JSON.parse(body);
}
export function privateError(error:unknown) {
  const status=error instanceof PrivateApiError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?422:503;
  return Response.json({error:error instanceof PrivateApiError?error.message:status===422?'Check the supplied fields.':'This information is temporarily unavailable.'},{status,headers:privateHeaders});
}
