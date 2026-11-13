import { db } from '@/lib/db';
import { listPublicResults,resultQuerySchema } from '@/modules/auctions/results';
import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
export const runtime='nodejs';
export async function GET(request:Request) {
 try{
  await requireUser(request);
  const query=resultQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!query.success)return Response.json({error:'Invalid result filters.'},{status:422,headers:privateHeaders});
  return Response.json(await listPublicResults(db,query.data),{headers:privateHeaders});
 }catch(error){return privateError(error)}
}
