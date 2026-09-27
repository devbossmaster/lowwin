import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser,requireMutationOrigin,smallJson,privateHeaders,privateError } from '@/modules/auth/private-api';
import { favoriteState } from '@/modules/profile/personal';
export const runtime='nodejs';
type Context={params:Promise<{slug:string}>};
export async function GET(request:Request,{params}:Context){try{return Response.json(await favoriteState(db,await requireUser(request),(await params).slug),{headers:privateHeaders})}catch(error){return privateError(error)}}
export async function PUT(request:Request,{params}:Context){try{const user=await requireUser(request);requireMutationOrigin(request);const {saved}=z.object({saved:z.boolean()}).strict().parse(await smallJson(request));return Response.json(await favoriteState(db,user,(await params).slug,saved),{headers:privateHeaders})}catch(error){return privateError(error)}}
