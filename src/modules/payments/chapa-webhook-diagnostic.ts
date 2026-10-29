import {createHash,timingSafeEqual} from 'node:crypto';
import {chapaWebhookAuthentication,verifyChapaWebhookRequest} from './chapa-provider';

type Environment=Record<string,string|undefined>;
const same=(actual:Uint8Array,expected:string)=>timingSafeEqual(createHash('sha256').update(actual).digest(),createHash('sha256').update(expected).digest());

function authorizationValue(input:string){
 const value=input.trim();
 if(value.startsWith('{')){
  try{
   const headers:unknown=JSON.parse(value);
   if(!headers||typeof headers!=='object'||Array.isArray(headers))return null;
   const entries=Object.entries(headers).filter(([key])=>key.toLowerCase()==='authorization');
   return entries.length===1&&typeof entries[0][1]==='string'?entries[0][1]:null;
  }catch{return null}
 }
 return value.replace(/^authorization\s*:\s*/i,'');
}

function encryptedEnvelope(password:Buffer){
 const encoded=password.toString('utf8');
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return false;
 const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)return false;
 try{
  const value:unknown=JSON.parse(bytes.toString('utf8'));
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&['iv','value','mac'].every(key=>typeof Reflect.get(value,key)==='string')&&(!('tag' in value)||typeof Reflect.get(value,'tag')==='string');
 }catch{return false}
}

/** Offline operator diagnosis only. No credentials, hashes, or decoded content
 * leave this function; the production authenticator remains authoritative. */
export function diagnoseChapaWebhookAuthorization(input:string,environment:Environment=process.env){
 const authentication=chapaWebhookAuthentication(environment),mode=authentication.mode==='basic'||authentication.mode==='signature'?authentication.mode:'invalid';
 const tooLarge=input.length>8192,value=tooLarge?null:authorizationValue(input);
 const scheme=!value?'missing':/^Basic(?:\s|$)/i.test(value)?'basic':/^Bearer(?:\s|$)/i.test(value)?'bearer':'other';
 const match=value?/^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(value):null,decoded=match?Buffer.from(match[1],'base64'):null;
 const canonical=!!match&&decoded!.toString('base64')===match[1],separator=canonical?decoded!.indexOf(58):-1;
 const usernameMatches=separator>=0?same(decoded!.subarray(0,separator),environment.CHAPA_WEBHOOK_BASIC_USERNAME??''):false;
 const passwordMatches=separator>=0?same(decoded!.subarray(separator+1),environment.CHAPA_WEBHOOK_BASIC_PASSWORD??''):false;
 const passwordLooksEncrypted=separator>=0&&encryptedEnvelope(decoded!.subarray(separator+1));
 const headerTooLong=!!value&&value.length>512;
 let accepted:boolean|null=null;
 if(mode!=='signature'){
  try{accepted=!!value&&verifyChapaWebhookRequest(new Uint8Array(),new Headers({authorization:value}),environment)}catch{accepted=false}
 }
 const diagnosis=tooLarge?'INPUT_TOO_LARGE':mode==='invalid'||!authentication.valid?'INVALID_AUTH_CONFIGURATION':mode==='signature'?'SIGNATURE_REQUIRES_EXACT_RAW_BODY':accepted?'MATCHES_DEPLOYED_BASIC_AUTH':!value?'MISSING_AUTHORIZATION':scheme!=='basic'?'AUTH_SCHEME_MISMATCH':headerTooLong?'AUTHORIZATION_TOO_LONG':!canonical||separator<0?'MALFORMED_BASIC_AUTH':!usernameMatches?'USERNAME_MISMATCH':passwordLooksEncrypted?'RECEIVED_PASSWORD_ENVELOPE_MISMATCH':'PASSWORD_MISMATCH';
 return {configuredAuth:mode,configurationValid:authentication.valid,authorizationPresent:!!value,authorizationScheme:scheme,canonicalBasicFormat:canonical,credentialsHaveSeparator:separator>=0,headerTooLong,usernameMatches,passwordMatches,passwordLooksEncrypted,authenticationAccepted:accepted,diagnosis};
}
