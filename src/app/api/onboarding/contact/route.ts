import {getLaunchSession,localMiniPreview} from '@/modules/auth/mini-access';
import {databaseErrorSummary} from '@/lib/database-error';
import {db} from '@/lib/db';
import {getEnv} from '@/lib/env';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {readRequestText,RequestBodyError} from '@/lib/request-body';
import {isRegisteredTelegramUser} from '@/modules/auth/own-contact';
import {privateHeaders,privateError,PrivateApiError,requireMutationOrigin} from '@/modules/auth/private-api';
import {miniAppBody,validateTelegramInitData} from '@/modules/auth/telegram-validation';
export const runtime='nodejs';
type ContactStage='origin'|'launch-validation'|'session-read'|'contact-status'|'rate-limit';
function contactRequest(method:'GET'|'POST'){
 const started=performance.now(),timings:Array<{stage:ContactStage;duration:number}>=[];
 let stage:ContactStage=method==='POST'?'origin':'session-read',stageStarted=started;
 const enter=(next:ContactStage)=>{const now=performance.now();timings.push({stage,duration:now-stageStarted});stage=next;stageStarted=now};
 const done=(response:Response)=>{
  const now=performance.now(),headers=new Headers(response.headers);
  const values=[{stage:'contact',duration:now-started},...timings,{stage,duration:now-stageStarted}];
  headers.set('Server-Timing',values.map(value=>`${value.stage};dur=${Math.round(value.duration)}`).join(', '));
  return new Response(response.body,{status:response.status,headers});
 };
 const failed=(error:unknown)=>{
  const response=privateError(error);
  if(response.status===503&&!(error instanceof PrivateApiError)){
   const {code,kind,sqlState,reason}=databaseErrorSummary(error);
   console.warn('contact_request_error',{method,stage,code,kind,...(sqlState?{sqlState}:{}),...(reason?{reason}:{}),elapsedMs:Math.round(performance.now()-started)});
  }
  return done(response);
 };
 return {enter,done,failed};
}
export async function GET(request:Request){const timing=contactRequest('GET');try{
 const session=await getLaunchSession(request.headers);if(!session)throw new PrivateApiError(401,'Reopen Lowwin from Telegram.');
 timing.enter('contact-status');
 const local=session.user.id==='lowin-local-test-user'&&localMiniPreview(request.headers);
 return timing.done(Response.json(local?{verified:true,masked:null,fixture:true}:session.contactStatus,{headers:privateHeaders}));
}catch(error){return timing.failed(error)}}
export async function POST(request:Request){const timing=contactRequest('POST');try{
 requireMutationOrigin(request);
 if(request.body){
  timing.enter('launch-validation');
  const botToken=getEnv().TELEGRAM_BOT_TOKEN;
  let telegramId:string;
  try{
   const {initData}=miniAppBody.parse(JSON.parse(await readRequestText(request,20_000)));
   telegramId=String(validateTelegramInitData(initData,botToken).id);
  }catch(error){
   if(error instanceof RequestBodyError)throw new PrivateApiError(error.status,error.message);
   throw new PrivateApiError(401,'Reopen Lowwin from Telegram.');
  }
  timing.enter('rate-limit');
  if(!await allowIdentityRequest(db,'onboarding-contact',telegramId,36))return timing.done(Response.json({error:'Wait a moment and retry contact verification.'},{status:429,headers:{...privateHeaders,'Retry-After':'60'}}));
  timing.enter('contact-status');
  const verified=await isRegisteredTelegramUser(db,telegramId);
  return timing.done(Response.json({verified,masked:null},{headers:privateHeaders}));
 }
 timing.enter('session-read');
 const session=await getLaunchSession(request.headers);if(!session)throw new PrivateApiError(401,'Reopen Lowwin from Telegram.');
 if(!session.telegramId)throw new PrivateApiError(403,'A verified Telegram launch is required.');
 timing.enter('contact-status');
 if(session.contactStatus.verified)return timing.done(Response.json({verified:true},{headers:privateHeaders}));
 // Older clients may still call this endpoint without launch data. Only
 // Telegram's native consent and the bot webhook can verify contact sharing.
 return timing.done(Response.json({error:'Share your contact inside Telegram.',code:'NATIVE_CONTACT_REQUIRED'},{status:410,headers:privateHeaders}));
}catch(error){return timing.failed(error)}}
