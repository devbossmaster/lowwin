import { db } from '@/lib/db';
import { requireUser,privateHeaders,privateError } from '@/modules/auth/private-api';
import { getPersonalWins,pageSchema } from '@/modules/profile/personal';
export const runtime='nodejs';
export async function GET(request:Request){try{const user=await requireUser(request);return Response.json(await getPersonalWins(db,user,pageSchema.parse(new URL(request.url).searchParams.get('page')??1)),{headers:privateHeaders})}catch(error){return privateError(error)}}
