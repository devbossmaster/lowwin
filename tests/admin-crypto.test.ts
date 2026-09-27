import {describe,it,expect} from 'vitest';
import {totp,verifyTotp} from '../src/modules/admin/crypto';
describe('staff RFC6238 compatibility',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 it('matches the six-digit truncation of the RFC6238 SHA-1 test vectors',()=>{
  for(const [seconds,code] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']] as const)expect(totp(secret,BigInt(Math.floor(seconds/30)))).toBe(code);
 });
 it('rejects reused counters, malformed codes and codes outside the adjacent window',()=>{
  const now=new Date(1234567890*1000),counter=BigInt(Math.floor(now.getTime()/30000)),code=totp(secret,counter);
  expect(verifyTotp(secret,code,now,counter)).toBeNull();expect(verifyTotp(secret,'x'.repeat(6),now,-1n)).toBeNull();expect(verifyTotp(secret,totp(secret,counter-2n),now,-1n)).toBeNull();expect(verifyTotp(secret,code,now,counter-1n)).toBe(counter);
 });
});
