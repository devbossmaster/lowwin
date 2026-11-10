import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';

const f=vi.hoisted(()=>({db:{},auth:vi.fn(),prepare:vi.fn(),reauthorize:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:f.db}));
vi.mock('../src/modules/payments/session',()=>({requirePaymentSession:f.auth}));
vi.mock('../src/modules/payments/chapa-direct',()=>({createBidDirectCheckout:f.prepare}));
import {POST} from '../src/app/api/payments/chapa/direct/bid/route';
import {PrivateApiError} from '../src/modules/auth/private-api';
import {ChapaError} from '../src/modules/payments/chapa-provider';

const origin='https://lowwin.test';
const command={key:randomUUID(),purpose:'BID',auctionSlug:'fixture-auction',numbers:['2','3'],feeVersion:1,approvedTotal:'20.00',paymentMethod:'telebirr',phone:'0911652904'};
const request=(body:unknown=command,from=origin)=>new Request(origin+'/api/payments/chapa/direct/bid',{method:'POST',headers:{origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
const expectPrivate=(response:Response)=>{expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');expect(response.headers.get('Vary')).toBe('Cookie');expect(response.headers.get('Server-Timing')).toMatch(/(?:^|, )auth;dur=\d+\.\d/);expect(response.headers.get('Server-Timing')).toMatch(/(?:^|, )total;dur=\d+\.\d/)};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('BETTER_AUTH_URL',origin);f.auth.mockResolvedValue({userId:'signed-in-owner',reauthorize:f.reauthorize});f.prepare.mockResolvedValue({kind:'payment',order:{id:'owned-intent',status:'AUTH_NEEDED'}})});
afterEach(()=>vi.unstubAllEnvs());

describe('single-command bid HTTP boundary',()=>{
 it('returns202 with private timing headers and passes only the authenticated owner and transactional authorizer',async()=>{const response=await POST(request());expect(response.status).toBe(202);expect(await response.json()).toEqual({kind:'payment',order:{id:'owned-intent',status:'AUTH_NEEDED'}});expectPrivate(response);expect(f.prepare).toHaveBeenCalledExactlyOnceWith(f.db,'signed-in-owner',command,f.reauthorize)});
 it('returns200 for a changed quote without representing it as an initialized payment',async()=>{const quote={id:randomUUID(),total:'25.00',auctionSlug:command.auctionSlug};f.prepare.mockResolvedValue({kind:'quote',quote});const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({kind:'quote',quote});expectPrivate(response);expect(f.prepare).toHaveBeenCalledOnce()});
 it('rejects a foreign mutation origin before authentication or payment preparation',async()=>{const response=await POST(request(command,'https://foreign.test'));expect(response.status).toBe(403);expect(f.auth).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();expect(response.headers.get('Cache-Control')).toContain('private, no-store')});
 it('rejects an expired session before any payment preparation and keeps the error private',async()=>{f.auth.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));const response=await POST(request());expect(response.status).toBe(401);expect(f.prepare).not.toHaveBeenCalled();expectPrivate(response);expect(await response.json()).toMatchObject({error:'Sign in through Telegram.'})});
 it('retains rate limits and structured server rejections without leaking internal data',async()=>{f.prepare.mockRejectedValue(new ChapaError(429,'RATE_LIMITED','Wait a minute before trying again.'));const response=await POST(request());expect(response.status).toBe(429);expect(await response.json()).toEqual({code:'RATE_LIMITED',error:'Wait a minute before trying again.'});expectPrivate(response)});
 it('rejects an invalid body without invoking the preparation command',async()=>{const response=await POST(new Request(origin+'/api/payments/chapa/direct/bid',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:'{invalid'}));expect(response.status).toBe(422);expect(f.prepare).not.toHaveBeenCalled();expectPrivate(response)});
 it('does not expose a raw internal exception through the private API',async()=>{f.prepare.mockRejectedValue(Error('postgres://private-database PIN secret'));const response=await POST(request());expect(response.status).toBe(503);const body=await response.text();expect(body).not.toContain('private-database');expect(body).not.toContain('PIN secret');expectPrivate(response)});
});
