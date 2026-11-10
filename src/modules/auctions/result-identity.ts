import {contactBotId,decryptPhone} from '@/modules/auth/own-contact';

/** Public identity is an explicit allowlist, never an email/contact fallback. */
export function safeResultIdentity(user:{name?:string|null;telegramUsername?:string|null}|null|undefined){
 const raw=user?.name?.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,'').replace(/\s+/g,' ').trim()??'';
 const displayName=raw&&!/(?:\+?\p{Nd}[\s().-]*){7,}/u.test(raw)&&!/[\w.+-]+@[^\s@]+\.[^\s@]+/.test(raw)?raw.slice(0,80):null;
 const handle=user?.telegramUsername?.replace(/^@/,'')??'';
 return {displayName,username:/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(handle)?`@${handle}`:null};
}

/** Existing result masking: country prefix plus exactly three hidden middle
 * national digits. Raw phone/cipher data never leaves this server helper. */
export function maskResultPhone(value:string):string|null{
 if(!/^\+[1-9]\d{7,14}$/.test(value))return null;
 const prefix=value.startsWith('+251')?'+251':'+',digits=value.slice(prefix.length),at=Math.floor((digits.length-3)/2);
 return prefix+digits.slice(0,at)+'***'+digits.slice(at+3);
}
export function maskedResultContact(contact:{botId:string;phoneCipher:string;revokedAt:Date|null}|null|undefined){
 if(!contact||contact.revokedAt)return null;
 try{if(contact.botId!==contactBotId())return null;return maskResultPhone(decryptPhone(contact.phoneCipher,contact.botId))}catch{return null}
}
