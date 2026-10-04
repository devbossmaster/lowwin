import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/db';
import {hash} from '@/modules/payments/provider';
import {completeVerifyWebhook} from '@/modules/payments/service';

export const runtime='nodejs';
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore={'Cache-Control':'no-store'};
function validSignature(timestamp:string,body:Buffer,header:string){
 const secrets=[process.env.VERIFY_ET_WEBHOOK_SECRET,process.env.VERIFY_ET_WEBHOOK_SECRET_PREVIOUS].filter((s):s is string=>!!s&&s.startsWith('whsec_'));
 const sentAt=Date.parse(timestamp);if(!secrets.length||!Number.isFinite(sentAt)||Math.abs(Date.now()-sentAt)>300000)return false;
 const signatures=header.split(',').map(part=>part.trim()).filter(part=>/^sha256=[a-f0-9]{64}$/i.test(part)).map(part=>Buffer.from(part.slice(7),'hex'));
 const prefix=Buffer.from(`${timestamp}.`);
 return secrets.some(secret=>{const expected=createHmac('sha256',secret).update(prefix).update(body).digest();return signatures.some(actual=>actual.length===expected.length&&timingSafeEqual(actual,expected))});
}
export async function POST(request:Request){
 // Log only server-generated context and fixed outcomes, never headers or bodies.
 const started=performance.now(),traceId=randomUUID();
 const path=new URL(request.url).pathname==='/webhooks/verify'?'/webhooks/verify':'/api/payments/verify-et/webhook';
 console.info(JSON.stringify({event:'verify_et_webhook_received',traceId,path}));
 const reply=(status:number,outcome:string,retry=false)=>{
  console.info(JSON.stringify({event:'verify_et_webhook_response',traceId,path,status,outcome,durationMs:Math.round(performance.now()-started)}));
  return new Response(null,{status,headers:retry?{...noStore,'Retry-After':'30'}:noStore});
 };
 const size=Number(request.headers.get('content-length'));if(size>65536)return reply(413,'body_too_large');
 let bytes:Buffer;
 try{bytes=Buffer.from(await request.arrayBuffer())}catch{return reply(400,'body_unreadable')}
 if(bytes.length>65536)return reply(413,'body_too_large');
 const timestamp=request.headers.get('x-webhook-timestamp')??'';
 if(!validSignature(timestamp,bytes,request.headers.get('x-webhook-signature')??''))return reply(401,'signature_rejected');
 let payload:unknown;try{payload=JSON.parse(bytes.toString('utf8'))}catch{return reply(400,'invalid_json')}finally{bytes.fill(0)}
 if(!payload||typeof payload!=='object')return reply(400,'invalid_payload');
 const event=payload as {id?:unknown;event?:unknown;requestId?:unknown;data?:{processingStatus?:unknown}};
 if(request.headers.get('x-webhook-test')==='true'||event.event==='webhook.test')return reply(204,'test_accepted');
 const eventId=request.headers.get('x-webhook-event-id');
 if(!id.test(String(event.id))||event.id!==eventId||!id.test(String(event.requestId))||event.event!=='verification.completed'||request.headers.get('x-webhook-event')!==event.event)return reply(400,'invalid_event');
 const payloadHash=hash(JSON.stringify(payload));
 try{
  await db.$transaction(async tx=>{
   const prior=await tx.verifyWebhookEvent.findUnique({where:{id:event.id as string}});
   if(prior){if(prior.payloadHash!==payloadHash||prior.requestId!==event.requestId)throw new Error('EVENT_CONFLICT');return}
   await tx.verifyWebhookEvent.create({data:{id:event.id as string,requestId:event.requestId as string,event:event.event as string,payloadHash,processingStatus:typeof event.data?.processingStatus==='string'?event.data.processingStatus.slice(0,32):null}});
   await tx.verifyRequest.updateMany({where:{requestId:event.requestId as string,state:{in:['SUBMITTING','PROCESSING']}},data:{nextCheckAt:new Date()}});
  });
  // A completion can arrive before POST /verify returns its request ID. Ask
  // Verify.et to redeliver; the durable event fingerprint alone lacks evidence.
  if(!await completeVerifyWebhook(db,event.requestId as string,event.data))return reply(503,'request_not_bound',true);
  return reply(204,'event_handled');
 }catch(error){return error instanceof Error&&error.message==='EVENT_CONFLICT'?reply(409,'event_conflict'):reply(503,'processing_failed')}
}
