import {constants,createHash,createPublicKey,randomBytes,timingSafeEqual,verify,type JsonWebKey} from 'node:crypto';
import {isIP} from 'node:net';
import {miniReturnPath} from '@/lib/mini-return';
import {normalizePhone} from './own-contact';
import {telegramPhotoUrl} from './telegram-validation';

export const TELEGRAM_OIDC_ISSUER='https://oauth.telegram.org';
export const TELEGRAM_BROWSER_MIGRATION='202611130002_telegram_browser_login';
export const TELEGRAM_BROWSER_TTL_SECONDS=600;
export type TelegramBrowserErrorCode='cancelled'|'expired'|'unavailable'|'invalid'|'contact_required'|'conflict';
export class TelegramBrowserError extends Error{constructor(public readonly code:TelegramBrowserErrorCode){super(code);this.name='TelegramBrowserError'}}
export type TelegramBrowserSettings={enabled:true;clientId:string;clientSecret:string;origin:string;callback:string;secure:boolean};
export function telegramBrowserSettings(raw:Record<string,string|undefined>=process.env):TelegramBrowserSettings|null{
 if(raw.TELEGRAM_LOGIN_ENABLED!=='true')return null;
 const clientId=raw.TELEGRAM_LOGIN_CLIENT_ID??'',clientSecret=raw.TELEGRAM_LOGIN_CLIENT_SECRET??'',botId=raw.TELEGRAM_BOT_TOKEN?.split(':')[0];
 if(!/^\d{1,20}$/.test(clientId)||clientId!==botId||clientSecret.length<16||clientSecret.length>512||clientSecret.trim()!==clientSecret||/[\r\n]/.test(clientSecret))return null;
 try{const u=new URL(raw.BETTER_AUTH_URL??'');if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['https:','http:'].includes(u.protocol))return null;
  if(u.protocol!=='https:'&&(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!['local','test'].includes(raw.APP_ENV??'')||raw.NODE_ENV==='production'||raw.VERCEL))return null;
  return {enabled:true,clientId,clientSecret,origin:u.origin,callback:u.origin+'/api/auth/telegram/browser/callback',secure:u.protocol==='https:'};
 }catch{return null}
}
export function browserLoginConfig(raw:Record<string,string|undefined>=process.env){const configured=!!telegramBrowserSettings({...raw,TELEGRAM_LOGIN_ENABLED:'true'});return {enabled:raw.TELEGRAM_LOGIN_ENABLED==='true'&&configured,configured}}
export function browserLoginCookieName(settings:Pick<TelegramBrowserSettings,'secure'>){return `${settings.secure?'__Host-':''}lowwin.telegram-login`}
export function browserLoginCookie(settings:Pick<TelegramBrowserSettings,'secure'>,value:string,maxAge=TELEGRAM_BROWSER_TTL_SECONDS){return `${browserLoginCookieName(settings)}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${settings.secure?'; Secure':''}`}
export function browserLoginCookieValue(headers:Headers,settings:Pick<TelegramBrowserSettings,'secure'>){const name=browserLoginCookieName(settings);const values=(headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));if(values.length!==1)return null;try{return decodeURIComponent(values[0].slice(name.length+1))}catch{return null}}
export function browserLoginBinding(value:string|null){if(!value)return null;const parts=value.split('.');return parts.length===2&&parts.every(v=>/^[A-Za-z0-9_-]{43}$/.test(v))?{state:parts[0],secret:parts[1]}:null}
export function hashBrowserLoginValue(value:string){return createHash('sha256').update(value).digest('hex')}
export function equalBrowserLoginHash(a:string,b:string){return /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'))}
export type TelegramBrowserChallenge={state:string;bindingHash:string;verifier:string;nonce:string;next:string;lang:'en'|'am';createdAt:number;clientId:string;callback:string};
export function newBrowserLoginChallenge(settings:TelegramBrowserSettings,next:string|null,language:string|null,now=Date.now()){
 const state=randomBytes(32).toString('base64url'),secret=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
 const challenge:TelegramBrowserChallenge={state,bindingHash:hashBrowserLoginValue(secret),verifier,nonce:randomBytes(32).toString('base64url'),next:miniReturnPath(next),lang:language==='am'?'am':'en',createdAt:now,clientId:settings.clientId,callback:settings.callback};
 const url=new URL(TELEGRAM_OIDC_ISSUER+'/auth');
 url.search=new URLSearchParams({client_id:settings.clientId,redirect_uri:settings.callback,response_type:'code',scope:'openid profile phone telegram:bot_access',state,nonce:challenge.nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',lang:challenge.lang}).toString();
 return {challenge,cookieValue:`${state}.${secret}`,authorizationUrl:url.href};
}
export function validBrowserChallenge(value:unknown,settings:TelegramBrowserSettings,state:string,secret:string,now=Date.now()):value is TelegramBrowserChallenge{
 if(!value||typeof value!=='object')return false;const c=value as TelegramBrowserChallenge;
 return c.state===state&&c.clientId===settings.clientId&&c.callback===settings.callback&&equalBrowserLoginHash(c.bindingHash,hashBrowserLoginValue(secret))&&typeof c.verifier==='string'&&/^[A-Za-z0-9_-]{43}$/.test(c.verifier)&&typeof c.nonce==='string'&&/^[A-Za-z0-9_-]{43}$/.test(c.nonce)&&Number.isSafeInteger(c.createdAt)&&c.createdAt<=now+30000&&now-c.createdAt<TELEGRAM_BROWSER_TTL_SECONDS*1000&&miniReturnPath(c.next)===c.next&&(c.lang==='en'||c.lang==='am');
}
export function browserRateIdentity(request:Request){const raw=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??request.headers.get('x-real-ip')?.trim()??'';return isIP(raw)?raw:'unattributed-browser'}
export type TelegramBrowserClaims={telegramId:string;subject:string;name:string;username:string|null;image:string|null;phone:string|null};
type Jwk=JsonWebKey&{kid?:string;alg?:string;use?:string;key_ops?:string[]};
function decodePart(value:string){if(!/^[A-Za-z0-9_-]+$/.test(value))throw new TelegramBrowserError('invalid');const buffer=Buffer.from(value,'base64url');if(buffer.toString('base64url')!==value)throw new TelegramBrowserError('invalid');return buffer}
export function verifyTelegramBrowserToken(token:string,settings:TelegramBrowserSettings,challenge:TelegramBrowserChallenge,keys:readonly Jwk[],now=Math.floor(Date.now()/1000)):TelegramBrowserClaims{
 try{
  if(token.length>16384)throw Error();const parts=token.split('.');if(parts.length!==3)throw Error();
  const header=JSON.parse(decodePart(parts[0]).toString('utf8')) as Record<string,unknown>,claims=JSON.parse(decodePart(parts[1]).toString('utf8')) as Record<string,unknown>;
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>160||!header.kid||header.crit!==undefined||header.b64!==undefined||header.typ!==undefined&&header.typ!=='JWT')throw Error();
  const candidates=keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')&&(!k.key_ops||k.key_ops.includes('verify')));if(candidates.length!==1)throw Error();
  const key=createPublicKey({key:candidates[0],format:'jwk'});if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048||(key.asymmetricKeyDetails?.modulusLength??0)>8192)throw Error();
  if(!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),{key,padding:constants.RSA_PKCS1_PADDING},decodePart(parts[2])))throw Error();
  if(claims.iss!==TELEGRAM_OIDC_ISSUER||claims.aud!==settings.clientId||claims.nonce!==challenge.nonce||typeof claims.sub!=='string'||!/^[A-Za-z0-9._~:-]{1,200}$/.test(claims.sub))throw Error();
  if(typeof claims.exp!=='number'||!Number.isSafeInteger(claims.exp)||claims.exp<=now||typeof claims.iat!=='number'||!Number.isSafeInteger(claims.iat)||claims.iat>now+30||claims.iat<Math.floor(challenge.createdAt/1000)-30||now-claims.iat>TELEGRAM_BROWSER_TTL_SECONDS||claims.exp<=claims.iat||claims.nbf!==undefined&&(typeof claims.nbf!=='number'||claims.nbf>now+30))throw Error();
  if(typeof claims.id!=='number'||!Number.isSafeInteger(claims.id)||claims.id<=0||typeof claims.name!=='string'||!claims.name.trim()||claims.name.length>256)throw Error();
  let phone:string|null=null;if(claims.phone_number_verified===true&&typeof claims.phone_number==='string'){try{phone=normalizePhone(claims.phone_number)}catch{}}
  return {telegramId:String(claims.id),subject:claims.sub,name:claims.name.trim(),username:typeof claims.preferred_username==='string'&&/^[A-Za-z0-9_]{1,64}$/.test(claims.preferred_username)?claims.preferred_username:null,image:telegramPhotoUrl(claims.picture),phone};
 }catch{throw new TelegramBrowserError('invalid')}
}
async function boundedProviderJson(response:Response,maxBytes=65536){if(!response.ok)throw new TelegramBrowserError('unavailable');const contentLength=Number(response.headers.get('content-length')??0);if(contentLength>maxBytes)throw new TelegramBrowserError('unavailable');const reader=response.body?.getReader();if(!reader)throw new TelegramBrowserError('unavailable');let total=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maxBytes){await reader.cancel();throw new TelegramBrowserError('unavailable')}chunks.push(value)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown}catch{throw new TelegramBrowserError('unavailable')}}
type Fetch=typeof fetch;
let jwksCache:{keys:Jwk[];expiresAt:number;refreshedAt:number}|null=null,jwksPending:Promise<Jwk[]>|null=null;
export async function telegramBrowserKeys(transport:Fetch=fetch,force=false):Promise<Jwk[]>{
 const now=Date.now();if(jwksCache&&now<jwksCache.expiresAt&&(!force||now-jwksCache.refreshedAt<30000))return jwksCache.keys;if(jwksPending)return jwksPending;
 const work=(async()=>{try{const body=await boundedProviderJson(await transport(TELEGRAM_OIDC_ISSUER+'/.well-known/jwks.json',{headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)})) as {keys?:Jwk[]};if(!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>16)throw new TelegramBrowserError('unavailable');jwksCache={keys:body.keys,expiresAt:Date.now()+300000,refreshedAt:Date.now()};return body.keys}catch{throw new TelegramBrowserError('unavailable')}})();
 jwksPending=work;try{return await work}finally{if(jwksPending===work)jwksPending=null}
}
export async function exchangeTelegramBrowserCode(code:string,settings:TelegramBrowserSettings,challenge:TelegramBrowserChallenge,transport:Fetch=fetch){
 try{
  const response=await transport(TELEGRAM_OIDC_ISSUER+'/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:settings.callback,client_id:settings.clientId,code_verifier:challenge.verifier}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  const body=await boundedProviderJson(response,32768) as {id_token?:unknown};if(typeof body.id_token!=='string')throw new TelegramBrowserError('invalid');
  const keys=await telegramBrowserKeys(transport);let header:Record<string,unknown>;try{header=JSON.parse(Buffer.from(body.id_token.split('.')[0],'base64url').toString('utf8'))}catch{throw new TelegramBrowserError('invalid')}
  const current=typeof header.kid==='string'&&keys.some(k=>k.kid===header.kid)?keys:await telegramBrowserKeys(transport,true);
  return verifyTelegramBrowserToken(body.id_token,settings,challenge,current);
 }catch(error){if(error instanceof TelegramBrowserError)throw error;throw new TelegramBrowserError('unavailable')}
}
