import {db} from '@/lib/db';
import {getLaunchSession,localMiniPreview} from '@/modules/auth/mini-access';
import {databaseErrorSummary} from '@/lib/database-error';
import {privateHeaders,privateError,PrivateApiError,requireMutationOrigin} from '@/modules/auth/private-api';
import {createBot} from '@/modules/bot/bot';
import {CONTACT_REPLY_KEYBOARD,CONTACT_REQUEST_MESSAGE} from '@/modules/bot/onboarding-copy';
import {allowContactRequest} from '@/modules/auth/contact-request-limit';
export const runtime='nodejs';
type ContactStage='origin'|'session-read'|'contact-status'|'rate-limit'|'bot-send';
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
 timing.enter('session-read');
 const session=await getLaunchSession(request.headers);if(!session)throw new PrivateApiError(401,'Reopen Lowwin from Telegram.');
 if(!session.telegramId)throw new PrivateApiError(403,'A verified Telegram launch is required.');
 timing.enter('contact-status');
 if(session.contactStatus.verified)return timing.done(Response.json({verified:true},{headers:privateHeaders}));
 timing.enter('rate-limit');
 const allowed=await allowContactRequest(db,session.user.id);
 if(!allowed)throw new PrivateApiError(429,'Contact request already sent. Check the bot or retry in a minute.');
 timing.enter('bot-send');
 await createBot().api.sendMessage(session.telegramId,CONTACT_REQUEST_MESSAGE,{reply_markup:CONTACT_REPLY_KEYBOARD});
 return timing.done(Response.json({sent:true},{headers:privateHeaders}));
}catch(error){return timing.failed(error)}}
