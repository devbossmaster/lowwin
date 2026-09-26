import { describe, expect, it } from 'vitest';
import { validateTelegramInitData } from '../src/modules/auth/telegram-validation';
import { assertLocalDevelopment, parseEnv } from '../src/lib/env';
import { pointsSchema } from '../src/modules/wallet/ledger';
import { validWebhookSecret } from '../src/modules/bot/webhook';
import { getFundingProvider } from '../src/modules/wallet/topups';
import { signedLaunch, TEST_TOKEN } from './helpers';
describe('Telegram signature boundary', () => {
  it('accepts a valid raw signed launch',()=>expect(validateTelegramInitData(signedLaunch(),TEST_TOKEN).id).toBe(778899));
  it.each([
    ['changed hash',()=>signedLaunch().replace(/hash=([a-f0-9])/,(_,character:string)=>`hash=${character==='f'?'e':'f'}`)],
    ['stale timestamp',()=>signedLaunch({auth_date:'100'})],
    ['future timestamp',()=>signedLaunch({auth_date:String(Math.floor(Date.now()/1000)+60)})],
    ['missing data',()=>''],
    ['missing user',()=>signedLaunch({user:'null'})],
    ['invalid user ID',()=>signedLaunch({user:JSON.stringify({id:-1,first_name:'Test'})})],
    ['wrong bot token',()=>signedLaunch({},'wrong-token')],
    ['duplicate fields',()=>signedLaunch()+'&auth_date=100'],
    ['tampered name',()=>signedLaunch().replace('Test+player','Other+name')],
  ])('rejects %s',(_,make)=>expect(()=>validateTelegramInitData(make(),TEST_TOKEN)).toThrow());
});
describe('funding and webhook boundaries',()=>{
  it('compares webhook secrets and rejects missing or wrong values',()=>{ expect(validWebhookSecret(null,'abc')).toBe(false); expect(validWebhookSecret('xyz','abc')).toBe(false); expect(validWebhookSecret('abc','abc')).toBe(true); });
  it.each(['1.5','-1','1e3','01','90000000000000000'])('rejects invalid points %s',v=>expect(()=>pointsSchema.parse(v)).toThrow());
  it('keeps points beyond floating point precision exact',()=>expect(pointsSchema.parse('9007199254740993')).toBe(9007199254740993n));
  it('rejects production dev credit even if the flag is true',()=>expect(()=>assertLocalDevelopment('points',{ NODE_ENV:'production', APP_ENV:'local', DEV_POINTS_ENABLED:'true', DATABASE_URL:'postgresql://localhost/lowin' })).toThrow());
  it('rejects hosted dev identity and remote development databases',()=>{ expect(()=>assertLocalDevelopment('identity',{ APP_ENV:'local', VERCEL:'1', DEV_IDENTITY_ENABLED:'true', DATABASE_URL:'postgresql://localhost/lowin' })).toThrow(); expect(()=>assertLocalDevelopment('points',{ APP_ENV:'local', DEV_POINTS_ENABLED:'true', DATABASE_URL:'postgresql://remote.invalid/lowin' })).toThrow(); });
  it('has no available top-up provider',()=>expect(getFundingProvider).toThrow());
  it('does not include secret values in environment errors',()=>{ try { parseEnv({ BETTER_AUTH_SECRET:'private-value' }); } catch(e) { expect(String(e)).not.toContain('private-value'); } });
});
