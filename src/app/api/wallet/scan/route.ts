import {db} from '@/lib/db';
import {privateHeaders,requireUser,requireMutationOrigin} from '@/modules/auth/private-api';
import {getMiniSession} from '@/modules/auth/mini-access';
import {paymentHealth,verifyIntentImage} from '@/modules/payments/service';
import {PaymentError} from '@/modules/payments/provider';
import {RECEIPT_LIMIT,validateReceiptImage} from '@/modules/payments/ocr';
import {paymentHttpError} from '@/modules/payments/http-error';
export const runtime='nodejs';
export async function POST(r:Request){const started=performance.now();const parts:Uint8Array[]=[];let upload:Buffer|undefined;try{
 requireMutationOrigin(r);const userId=await requireUser(r);if(!paymentHealth().ocr)throw new PaymentError(503,'Receipt image verification is unavailable. Paste the payment SMS or transaction ID.');const id=new URL(r.url).searchParams.get('intentId'),key=r.headers.get('idempotency-key');if(!id||!key)throw new PaymentError(422,'Image verification request is incomplete.');
 if(Number(r.headers.get('content-length'))>RECEIPT_LIMIT)throw new PaymentError(413,'Use an image smaller than 5 MB.');const reader=r.body?.getReader();if(!reader)throw new PaymentError(422,'Choose an image.');let count=0;for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>RECEIPT_LIMIT){await reader.cancel();throw new PaymentError(413,'Use an image smaller than 5 MB.')}parts.push(value)}
 upload=Buffer.concat(parts);const mime=r.headers.get('content-type')??'';await validateReceiptImage(upload,mime);const result=await verifyIntentImage(db,userId,{id,key},upload,mime as 'image/png'|'image/jpeg'|'image/webp',undefined,async tx=>{if((await getMiniSession(r.headers,tx))?.user.id!==userId)throw new PaymentError(401,'Sign in again.')});console.info(JSON.stringify({event:'receipt_image_verification',elapsedMs:Math.round(performance.now()-started),status:result.status,reason:result.reason}));return Response.json(result,{headers:privateHeaders});
 }catch(e){if(e instanceof PaymentError)console.warn(JSON.stringify({event:'receipt_image_verification_failed',elapsedMs:Math.round(performance.now()-started),status:e.status,reason:e.message}));return paymentHttpError(e,'scan',started)}finally{upload?.fill(0);for(const part of parts)part.fill(0)}}
