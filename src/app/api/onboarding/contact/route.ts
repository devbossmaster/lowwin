import {randomUUID} from 'node:crypto';
import {db} from '@/lib/db';
import {getLaunchSession,localMiniPreview} from '@/modules/auth/mini-access';
import {contactStatus} from '@/modules/auth/own-contact';
import {privateHeaders,privateError,PrivateApiError,requireMutationOrigin} from '@/modules/auth/private-api';
import {createBot} from '@/modules/bot/bot';
import {CONTACT_REPLY_KEYBOARD,CONTACT_REQUEST_MESSAGE} from '@/modules/bot/onboarding-copy';
export const runtime='nodejs';
export async function GET(request:Request){try{
 const session=await getLaunchSession(request.headers);if(!session)throw new PrivateApiError(401,'Reopen Lowwin from Telegram.');
 const local=session.user.id==='lowin-local-test-user'&&localMiniPreview(request.headers);
 return Response.json(local?{verified:true,masked:null,fixture:true}:await contactStatus(db,session.user.id),{headers:privateHeaders});
}catch(error){return privateError(error)}}
export async function POST(request:Request){try{
 requireMutationOrigin(request);
 const session=await getLaunchSession(request.headers);if(!session)throw new PrivateApiError(401,'Reopen Lowwin from Telegram.');
 const user=await db.user.findUniqueOrThrow({where:{id:session.user.id},select:{telegramId:true}});
 if(!user.telegramId)throw new PrivateApiError(403,'A verified Telegram launch is required.');
 if((await contactStatus(db,session.user.id,user.telegramId)).verified)return Response.json({verified:true},{headers:privateHeaders});
 const allowed=await db.$transaction(async tx=>{const key=`own-contact-request:${session.user.id}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;const now=BigInt(Date.now()),old=await tx.rateLimit.findUnique({where:{key}});if(old&&now-old.lastRequest<60000n)return false;await tx.rateLimit.upsert({where:{key},create:{id:randomUUID(),key,count:1,lastRequest:now},update:{count:1,lastRequest:now}});return true});
 if(!allowed)throw new PrivateApiError(429,'Contact request already sent. Check the bot or retry in a minute.');
 await createBot().api.sendMessage(user.telegramId,CONTACT_REQUEST_MESSAGE,{reply_markup:CONTACT_REPLY_KEYBOARD});
 return Response.json({sent:true},{headers:privateHeaders});
}catch(error){return privateError(error)}}
