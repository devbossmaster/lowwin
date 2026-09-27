import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {stagingDemoUser} from '../auctions/staging-demo';
type DB=Prisma.TransactionClient|PrismaClient;
export function contactBotId(){const id=process.env.TELEGRAM_BOT_TOKEN?.split(':')[0];if(!id||!/^\d+$/.test(id))throw Error('Contact bot unavailable');return id}
function localFixture(){try{const u=new URL(process.env.DATABASE_URL??'');return process.env.NODE_ENV!=='production'&&!process.env.VERCEL&&['local','test'].includes(process.env.APP_ENV??'')&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.pathname.endsWith('_test')}catch{return false}}
function keys(){const raw=process.env.PHONE_CONTACT_KEYS,ring=raw?JSON.parse(raw) as Record<string,string>:localFixture()?{'local-fixture':'e'.repeat(64)}:{};const id=process.env.PHONE_CONTACT_KEY_ID??'local-fixture';if(!/^[a-zA-Z0-9_-]{1,32}$/.test(id)||!ring[id]||Object.values(ring).some(k=>!/^[a-f0-9]{64}$/i.test(k)))throw Error('Phone protection unavailable');return {id,ring}}
export function normalizePhone(raw:string){let value=raw.replace(/[ ()-]/g,'');if(/^0[79]\d{8}$/.test(value))value='+251'+value.slice(1);else if(/^[1-9]\d{7,14}$/.test(value))value='+'+value;if(!/^\+[1-9]\d{7,14}$/.test(value))throw Error('Unsupported contact');return value}
export function encryptPhone(value:string,botId=contactBotId()){const {id,ring}=keys(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(ring[id],'hex'),iv);cipher.setAAD(Buffer.from(`lowin:own-contact:${botId}:${id}`));return `${id}.${Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url')}`}
function decryptPhone(value:string,botId:string){const {ring}=keys(),[id,data]=value.split('.');if(!ring[id])throw Error('Phone key unavailable');const b=Buffer.from(data,'base64url'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(ring[id],'hex'),b.subarray(0,12));decipher.setAAD(Buffer.from(`lowin:own-contact:${botId}:${id}`));decipher.setAuthTag(b.subarray(-16));return Buffer.concat([decipher.update(b.subarray(12,-16)),decipher.final()]).toString('utf8')}
function phoneHash(value:string){const secret=process.env.PHONE_CONTACT_HASH_KEY??(localFixture()?'f'.repeat(64):'');if(!/^[a-f0-9]{64}$/i.test(secret))throw Error('Phone lookup protection unavailable');return createHmac('sha256',Buffer.from(secret,'hex')).update(value).digest('hex')}
// Called only after authentic webhook-secret validation. Never persist raw phone/vCard.
export function protectContactPayload(payload:Record<string,unknown>,botId:string){
 const m=payload.message as Record<string,unknown>|undefined,c=m?.contact as Record<string,unknown>|undefined;if(!c)return payload;
 let phone:string|null=null;try{if(typeof c.phone_number==='string')phone=normalizePhone(c.phone_number)}catch{}
 return {...payload,message:{...m,contact:{user_id:c.user_id??null,phoneCipher:phone?encryptPhone(phone,botId):null}}};
}
export async function acceptOwnContact(tx:DB,payload:unknown,botId:string|null,updateId:bigint){
 const m=(payload as {message?:{chat?:{id?:number;type?:string};from?:{id?:number};forward_origin?:unknown;forward_from?:unknown;contact?:{user_id?:number;phoneCipher?:string}}}).message;
 if(!m?.contact)return null;const tid=String(m.from?.id??'unknown');
 const record=async(outcome:string)=>{await tx.contactEvent.createMany({data:[{botId:botId??'unbound',telegramId:tid,updateId,outcome}],skipDuplicates:true});return outcome};
 if(botId!==contactBotId()||m.chat?.type!=='private'||!Number.isSafeInteger(m.from?.id)||(m.from?.id??0)<=0||m.from!.id!==m.chat.id||m.contact.user_id!==m.from!.id||m.forward_origin||m.forward_from||!m.contact.phoneCipher)return record('REJECTED_IDENTITY');
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`own-contact:${botId}:${tid}`},0))`;
 let phone:string;try{phone=normalizePhone(decryptPhone(m.contact.phoneCipher,botId))}catch{return record('REJECTED_PAYLOAD')}const hash=phoneHash(phone);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${hash}`},0))`;
 const existing=await tx.telegramOwnContact.findUnique({where:{botId_telegramId:{botId,telegramId:tid}}}),owner=await tx.telegramOwnContact.findUnique({where:{phoneHash:hash}});
 if(owner&&(owner.telegramId!==tid||owner.botId!==botId)||existing&&(existing.phoneHash!==hash||existing.revokedAt))return record('CONFLICT_REQUIRES_SUPPORT');
 if(!existing){const user=await tx.user.findUnique({where:{telegramId:tid},select:{id:true}});await tx.telegramOwnContact.create({data:{telegramId:tid,botId,userId:user?.id,phoneHash:hash,phoneCipher:encryptPhone(phone,botId),lastFour:phone.slice(-4),verifiedAt:new Date(),sourceUpdateId:updateId}})}
 return record(existing?'ALREADY_VERIFIED':'VERIFIED');
}
export async function bindOwnContact(tx:DB,userId:string,telegramId:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`own-contact:${contactBotId()}:${telegramId}`},0))`;const row=await tx.telegramOwnContact.findUnique({where:{botId_telegramId:{botId:contactBotId(),telegramId}}});if(row&&!row.userId&&!row.revokedAt)await tx.telegramOwnContact.updateMany({where:{id:row.id,userId:null},data:{userId}})}
export async function contactStatus(tx:DB,userId:string,telegramId?:string|null){const row=await tx.telegramOwnContact.findUnique({where:{userId},select:{telegramId:true,botId:true,revokedAt:true,lastFour:true,user:{select:{telegramId:true}}}});return row&&row.telegramId===row.user?.telegramId&&!row.revokedAt&&row.botId===contactBotId()&&(!telegramId||row.telegramId===telegramId)?{verified:true,masked:`•••• ${row.lastFour}`}:{verified:false,masked:null}}
export async function assertPlayerContact(tx:DB,userId:string){const user=await tx.user.findUnique({where:{id:userId},select:{telegramId:true}});if(!user)throw Error('CONTACT_REQUIRED');if(!user.telegramId&&(localFixture()||userId.startsWith('demo-showcase-')&&stagingDemoUser(userId)))return; if(!(await contactStatus(tx,userId,user.telegramId)).verified)throw Error('CONTACT_REQUIRED')}
