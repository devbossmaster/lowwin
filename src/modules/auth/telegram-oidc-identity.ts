import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {APIError} from 'better-auth/api';
import {db} from '@/lib/db';
import {attributeNewReferralInTransaction} from '../referrals/service';
import {contactBotId,encryptPhone,normalizePhone,phoneHash} from './own-contact';
import {telegramPhotoUrl} from './telegram-validation';

const issuer='https://oauth.telegram.org';

/** Only pass claims from the upstream plugin's verified OIDC profile mapper.
 * This application policy does not replace its JWT, state, nonce or PKCE checks. */
export type VerifiedTelegramOIDCProfile={
 iss:string;aud:string;sub:string;id?:string|number;name?:string;
 given_name?:string;family_name?:string;preferred_username?:string;
 picture?:string;phone_number?:string;phone_number_verified?:boolean;
};

function reject(code:'invalid'|'contact_required'|'conflict'):never{
 const message=code==='contact_required'?'Share your phone number to finish signing in.':code==='conflict'?'This Telegram account needs support before it can sign in.':'Telegram identity could not be confirmed.';
 throw new APIError('FORBIDDEN',{code,message});
}

function telegramIdentity(claims:VerifiedTelegramOIDCProfile,clientId:string){
 const telegramId=typeof claims.id==='number'&&Number.isSafeInteger(claims.id)&&claims.id>0?String(claims.id):claims.id;
 if(contactBotId()!==clientId||claims.iss!==issuer||claims.aud!==clientId||typeof telegramId!=='string'||!/^[1-9]\d{0,19}$/.test(telegramId)||typeof claims.sub!=='string'||!claims.sub.trim()||claims.sub.length>200||/[\u0000-\u001f\u007f]/.test(claims.sub))reject('invalid');
 return telegramId;
}

function profileName(claims:VerifiedTelegramOIDCProfile){
 const supplied=(typeof claims.name==='string'?claims.name:'')||[claims.given_name,claims.family_name].filter((value):value is string=>typeof value==='string').join(' ')||(typeof claims.preferred_username==='string'?claims.preferred_username:'')||'LowWin player';
 return supplied.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,200)||'LowWin player';
}

/** Prepare LowWin's canonical identity before upstream Better Auth looks up the
 * OIDC account. Its original `sub` is the upstream account key. An older
 * bot-prefixed binding is checked and retained without moving accounts.
 *
 * This commits identity/contact policy only. Better Auth remains responsible
 * for the OAuth callback and session issuance after the mapper returns. */
export async function prepareTelegramOIDCIdentity(claims:VerifiedTelegramOIDCProfile,settings:{clientId:string},client:PrismaClient=db):Promise<{name:string;image?:string}>{
 const telegramId=telegramIdentity(claims,settings.clientId),botId=settings.clientId;
 const name=profileName(claims),image=telegramPhotoUrl(claims.picture),username=typeof claims.preferred_username==='string'&&/^[A-Za-z0-9_]{1,64}$/.test(claims.preferred_username)?claims.preferred_username:null;
 let consentedPhone:string|null=null;
 if(claims.phone_number_verified===true&&typeof claims.phone_number==='string'){
  try{consentedPhone=normalizePhone(claims.phone_number)}catch{}
 }
 await client.$transaction(async tx=>{
  // Match bot contact registration and Mini App sign-in lock ordering.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${telegramId}`},0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`own-contact:${botId}:${telegramId}`},0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-oidc:${botId}:${claims.sub}`},0))`;
  const [existing,canonical,oidc,legacy,contact]=await Promise.all([
   tx.user.findUnique({where:{telegramId},select:{id:true,role:true,staffMember:{select:{userId:true}},ownContact:{select:{id:true}}}}),
   tx.account.findUnique({where:{providerId_accountId:{providerId:'telegram',accountId:telegramId}},select:{id:true,userId:true,telegramId:true}}),
   tx.account.findUnique({where:{providerId_accountId:{providerId:'telegram-oidc',accountId:claims.sub}},select:{id:true,userId:true,telegramId:true}}),
   tx.account.findUnique({where:{providerId_accountId:{providerId:'telegram-oidc',accountId:`${botId}:${claims.sub}`}},select:{id:true,userId:true,telegramId:true}}),
   tx.telegramOwnContact.findUnique({where:{botId_telegramId:{botId,telegramId}}}),
  ]);
  if(existing&&(existing.role!=='member'||existing.staffMember)||existing?.ownContact&&existing.ownContact.id!==contact?.id)reject('conflict');
  for(const account of [canonical,oidc,legacy]){
   if(account&&(account.userId!==existing?.id||account.telegramId!==null&&account.telegramId!==telegramId))reject('conflict');
  }
  if(contact&&(contact.revokedAt||contact.userId&&contact.userId!==existing?.id))reject('conflict');
  let protectedPhone:{phoneHash:string;phoneCipher:string;lastFour:string}|null=null;
  if(!contact){
   if(!consentedPhone)reject('contact_required');
   const hash=phoneHash(consentedPhone);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${hash}`},0))`;
   const owner=await tx.telegramOwnContact.findUnique({where:{phoneHash:hash},select:{telegramId:true,botId:true}});
   if(owner&&(owner.telegramId!==telegramId||owner.botId!==botId))reject('conflict');
   protectedPhone={phoneHash:hash,phoneCipher:encryptPhone(consentedPhone,botId),lastFour:consentedPhone.slice(-4)};
  }
  const user=existing??await tx.user.create({data:{id:randomUUID(),name,image,telegramId,telegramUsername:username,role:'member'},select:{id:true}});
  if(!contact&&protectedPhone)await tx.telegramOwnContact.create({data:{telegramId,botId,userId:user.id,...protectedPhone,verifiedAt:new Date(),sourceUpdateId:null,verificationSource:'TELEGRAM_OIDC',oidcIssuer:issuer,oidcSubject:claims.sub}});
  else if(contact&&!contact.userId)await tx.telegramOwnContact.update({where:{id:contact.id},data:{userId:user.id}});
  if(!canonical)await tx.account.create({data:{id:randomUUID(),providerId:'telegram',accountId:telegramId,userId:user.id,telegramId,telegramUsername:username}});
  if(!oidc)await tx.account.create({data:{id:randomUUID(),providerId:'telegram-oidc',accountId:claims.sub,userId:user.id,telegramId}});
  await attributeNewReferralInTransaction(tx,user.id,telegramId,{newAccount:!existing});
 },{maxWait:10000,timeout:20000});
 return {name,...(image?{image}:{})};
}
