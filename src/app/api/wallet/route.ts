import { db } from '@/lib/db';
import { requireUser,privateHeaders,privateError } from '@/modules/auth/private-api';
import { pageSchema } from '@/modules/profile/personal';
import { getWalletView } from '@/modules/wallet/view';
export const runtime='nodejs';
export async function GET(request:Request) {
  try {
    const userId=await requireUser(request);
    return Response.json(await getWalletView(db,userId,pageSchema.parse(new URL(request.url).searchParams.get('page')??1)),{headers:privateHeaders});
  } catch(error) {return privateError(error)}
}
