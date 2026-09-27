import { createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret(){let bits='';for(const byte of randomBytes(20))bits+=byte.toString(2).padStart(8,'0');return bits.match(/.{5}/g)!.map(chunk=>alphabet[parseInt(chunk,2)]).join('')}
function decode32(secret:string){const bits=[...secret].map(char=>alphabet.indexOf(char).toString(2).padStart(5,'0')).join('');return Buffer.from(bits.match(/.{8}/g)!.map(chunk=>parseInt(chunk,2)))}
function key(){const raw=process.env.ADMIN_MFA_KEY;if(!raw||!/^[a-f0-9]{64}$/i.test(raw))throw new Error('Admin MFA encryption is unavailable');return Buffer.from(raw,'hex')}
export function seal(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url')}
export function unseal(value:string){const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8')}
export function totp(secret:string,counter:bigint){const buffer=Buffer.alloc(8);buffer.writeBigUInt64BE(counter);const mac=createHmac('sha1',decode32(secret)).update(buffer).digest(),offset=mac[19]&15;return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')}
export function verifyTotp(secret:string,code:string,now:Date,lastCounter:bigint){if(!/^\d{6}$/.test(code))return null;const step=BigInt(Math.floor(now.getTime()/30000));for(const delta of [0n,-1n,1n]){const counter=step+delta;if(counter>lastCounter&&timingSafeEqual(Buffer.from(totp(secret,counter)),Buffer.from(code)))return counter}return null}
