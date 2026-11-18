import {Api} from 'grammy';
import {z} from 'zod';
import {db} from '@/lib/db';
import {getEnv} from '@/lib/env';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {botReferralShareUrl} from '@/lib/referral-invite';
import {REFERRAL_SHARE_IMAGE,referralShareCopy} from '@/lib/referral-share';
import {getMiniSession} from '@/modules/auth/mini-access';
import {PrivateApiError,privateError,privateHeaders,requireMutationOrigin,smallJson} from '@/modules/auth/private-api';
import {getReferralPolicy,referralSchemaReady} from '@/modules/referrals/service';

export const runtime='nodejs';
const requestBody=z.object({language:z.enum(['en','am'])}).strict();

export async function POST(request:Request){
 try{
  requireMutationOrigin(request);
  const session=await getMiniSession(request.headers);
  if(!session)throw new PrivateApiError(401,'Sign in through Telegram.');
  if(session.session.telegramAuthSource!=='MINI_APP'||!session.telegramId||session.session.telegramLaunchId!==session.telegramId)throw new PrivateApiError(403,'Open LowWin in Telegram to prepare a chat message.');
  const telegramId=Number(session.telegramId);
  if(!Number.isSafeInteger(telegramId)||telegramId<1)throw new PrivateApiError(403,'Telegram account unavailable.');
  const {language}=requestBody.parse(await smallJson(request));
  if(!referralSchemaReady())throw new PrivateApiError(403,'Invitations are unavailable.');
  if(!await allowIdentityRequest(db,'telegram-referral-share',session.user.id,8))throw new PrivateApiError(429,'Too many share requests. Please wait and retry.');

  // The signed owner and saved invite choose the recipient and referral URL.
  // The request supplies only the presentation language.
  const [policy,invite]=await Promise.all([
   getReferralPolicy(db),
   db.referralInvite.findUnique({where:{userId:session.user.id},select:{token:true}}),
  ]);
  const env=getEnv();
  const url=invite&&policy.enabled?botReferralShareUrl(invite.token,env.TELEGRAM_BOT_USERNAME):null;
  if(!url)throw new PrivateApiError(403,'Invitations are unavailable.');
  const photo=new URL(REFERRAL_SHARE_IMAGE,env.MINI_APP_URL);
  if(photo.protocol!=='https:')throw new PrivateApiError(503,'Telegram photo sharing is unavailable.');
  const copy=referralShareCopy[language];
  const prepared=await new Api(env.TELEGRAM_BOT_TOKEN,{timeoutSeconds:5}).savePreparedInlineMessage(telegramId,{
   type:'photo',id:'lowwin-invite',photo_url:photo.href,thumbnail_url:photo.href,title:copy.title,caption:copy.caption,
   reply_markup:{inline_keyboard:[[{text:copy.button,url}]]},
  },{allow_user_chats:true,allow_group_chats:true,allow_channel_chats:true});
  return Response.json({id:prepared.id},{headers:privateHeaders});
 }catch(error){return privateError(error)}
}
