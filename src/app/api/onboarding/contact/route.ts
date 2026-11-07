import {getLaunchSession,localMiniPreview} from '@/modules/auth/mini-access';
import {databaseErrorSummary} from '@/lib/database-error';
import {privateHeaders,privateError,PrivateApiError,requireMutationOrigin} from '@/modules/auth/private-api';
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
 // The old contact-first reply keyboard is retired. Consent now belongs to
 // Telegram's native requestContact modal, opened only by the user's tap.
 return timing.done(Response.json({error:'Share your contact using the Log in sheet inside Telegram.',code:'NATIVE_CONTACT_REQUIRED'},{status:410,headers:privateHeaders}));
}catch(error){return timing.failed(error)}}
