import {z} from 'zod';
import {db} from '@/lib/db';
import {adminHeaders,requireAdmin} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {PrivateApiError,requireMutationOrigin,smallJson} from '@/modules/auth/private-api';
import {changeStaffPassword,requestStaffEmailChange} from '@/modules/auth/staff-profile';

export const runtime = 'nodejs';

const actions = z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('change-password'),currentPassword:z.string().min(1).max(128),newPassword:z.string().min(12).max(128)}),
  z.strictObject({action:z.literal('change-email'),newEmail:z.string().trim().toLowerCase().pipe(z.email().max(254))}),
]);

function failure(error:unknown) {
  if (error instanceof AdminError || error instanceof PrivateApiError) {
    return Response.json({error:error.message,...(error instanceof AdminError&&error.code?{code:error.code}:{})},{status:error.status,headers:adminHeaders});
  }
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
  return Response.json({error:invalid?'Check the supplied fields and try again.':'Profile is temporarily unavailable. Try again.'},{status:invalid?422:503,headers:adminHeaders});
}

export async function GET(request:Request) {
  try {
    const actor = await requireAdmin(db,request.headers);
    const profile = await db.user.findUniqueOrThrow({where:{id:actor.id},select:{email:true}});
    return Response.json(profile,{headers:adminHeaders});
  } catch (error) {return failure(error);}
}

export async function POST(request:Request) {
  try {
    requireMutationOrigin(request);
    const action = actions.parse(await smallJson(request));
    if (action.action==='change-email') return await requestStaffEmailChange(request,action.newEmail);
    return await changeStaffPassword(request,{currentPassword:action.currentPassword,newPassword:action.newPassword});
  } catch (error) {return failure(error);}
}
