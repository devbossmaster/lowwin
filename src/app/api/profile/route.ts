import { db } from '@/lib/db';
import { requireUser,requireMutationOrigin,smallJson,privateHeaders,privateError } from '@/modules/auth/private-api';
import { getPlayerProfile,editPlayerProfile } from '@/modules/profile/personal';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await getPlayerProfile(db,await requireUser(request)),{headers:privateHeaders})}catch(error){return privateError(error)}}
export async function PATCH(request:Request){try{const user=await requireUser(request);requireMutationOrigin(request);return Response.json(await editPlayerProfile(db,user,await smallJson(request)),{headers:privateHeaders})}catch(error){return privateError(error)}}
