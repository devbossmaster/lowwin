import { db } from '@/lib/db';
import { listPublicResults,resultQuerySchema } from '@/modules/auctions/results';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store, max-age=0'};
export async function GET(request:Request) {
  const query=resultQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!query.success)return Response.json({error:'Invalid result filters.'},{status:422,headers});
  try{return Response.json(await listPublicResults(db,query.data),{headers})}
  catch{return Response.json({error:'Results are temporarily unavailable.'},{status:503,headers})}
}
