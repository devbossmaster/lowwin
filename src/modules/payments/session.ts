import type {Prisma} from '@prisma/client';
import {getMiniSession,localMiniPreview} from '../auth/mini-access';
import {contactBotId} from '../auth/own-contact';
import {limitUserMutation,PrivateApiError} from '../auth/private-api';

// Validate the signed cookie before opening a money transaction. Do not build
// a Better Auth adapter or refresh a session inside that transaction. Instead,
// re-read the authenticated session and its current binding in one DB query.
export async function requirePaymentSession(request:Request){
 const current=await getMiniSession(request.headers);
 if(!current)throw new PrivateApiError(401,'Sign in through Telegram.');
 await limitUserMutation(request,current.user.id);
 const preview=current.user.id==='lowin-local-test-user'&&localMiniPreview(request.headers);
 const telegramId=current.telegramId;
 if(!preview&&!telegramId)throw new PrivateApiError(401,'Sign in through Telegram.');
 const botId=preview?null:contactBotId();
 return {userId:current.user.id,reauthorize:async(tx:Prisma.TransactionClient)=>{
  const valid=await tx.session.findFirst({where:{
   id:current.session.id,token:current.session.token,userId:current.user.id,expiresAt:{gt:new Date()},
   ...(!preview?{telegramLaunchId:telegramId,user:{is:{telegramId,staffMember:{is:null},ownContact:{is:{telegramId:telegramId!,botId:botId!,revokedAt:null}}}}}:{}),
  },select:{id:true}});
  if(!valid)throw new PrivateApiError(401,'Sign in through Telegram.');
 }};
}
