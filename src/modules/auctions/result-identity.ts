import {contactBotId,decryptPhone} from '@/modules/auth/own-contact';
import {maskPhoneDisplay} from '@/lib/phone-mask';

/** Public identity is an explicit allowlist, never an email/contact fallback. */
export function safeResultIdentity(user:{name?:string|null;telegramUsername?:string|null}|null|undefined){
 const raw=user?.name?.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,'').replace(/\s+/g,' ').trim()??'';
 const displayName=raw&&!/(?:\+?\p{Nd}[\s().-]*){7,}/u.test(raw)&&!/[\w.+-]+@[^\s@]+\.[^\s@]+/.test(raw)?raw.slice(0,80):null;
 const handle=user?.telegramUsername?.replace(/^@/,'')??'';
 return {displayName,username:/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(handle)?`@${handle}`:null};
}

export const maskResultPhone=maskPhoneDisplay;
export function maskedResultContact(contact:{botId:string;phoneCipher:string;revokedAt:Date|null}|null|undefined){
 if(!contact||contact.revokedAt)return null;
 try{if(contact.botId!==contactBotId())return null;return maskResultPhone(decryptPhone(contact.phoneCipher,contact.botId))}catch{return null}
}
