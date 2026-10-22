import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';

const mocks=vi.hoisted(()=>({
  launchSession:vi.fn(),localPreview:vi.fn(),contactStatus:vi.fn(),transaction:vi.fn(),sendMessage:vi.fn(),createBot:vi.fn(),
  userLookup:vi.fn(),contactLookup:vi.fn(),requestLimit:vi.fn(),
}));
vi.mock('../src/lib/db',()=>({db:{
  $transaction:mocks.transaction,user:{findUniqueOrThrow:mocks.userLookup},telegramOwnContact:{findUnique:mocks.contactLookup},
}}));
vi.mock('../src/modules/auth/mini-access',()=>({getLaunchSession:mocks.launchSession,getMiniSession:vi.fn(),localMiniPreview:mocks.localPreview}));
vi.mock('../src/modules/auth/own-contact',()=>({contactStatus:mocks.contactStatus}));
vi.mock('../src/modules/auth/contact-request-limit',()=>({allowContactRequest:mocks.requestLimit}));
vi.mock('../src/modules/bot/bot',()=>({createBot:mocks.createBot}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:vi.fn()}));
import {GET,POST} from '../src/app/api/onboarding/contact/route';
import {db} from '../src/lib/db';
import {CONTACT_REPLY_KEYBOARD,CONTACT_REQUEST_MESSAGE} from '../src/modules/bot/onboarding-copy';

const origin='https://lowwin.example';
const snapshot=(verified=false)=>({
  user:{id:'private-player'},session:{id:'private-session'},telegramId:'987654321',
  contactStatus:{verified,masked:verified?'•••• 1234':null},
});
function request(method:'GET'|'POST',requestOrigin=origin){
  return new Request(`${origin}/api/onboarding/contact`,{method,headers:{origin:requestOrigin,cookie:'private-session-cookie'}});
}
function expectPrivateTiming(response:Response){
  expect(response.headers.get('cache-control')).toContain('private');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('server-timing')).toMatch(/(?:^|,)\s*contact(?:[-_]total)?;dur=\d+(?:\.\d+)?/);
  expect(response.headers.get('server-timing')).toMatch(/(?:^|,)\s*(?:session-read|contact-status|rate-limit|bot-send|origin);dur=\d+(?:\.\d+)?/);
  expect(response.headers.has('set-cookie')).toBe(false);
}
function expectNoContactLookup(){
  expect(mocks.contactStatus).not.toHaveBeenCalled();
  expect(mocks.userLookup).not.toHaveBeenCalled();
  expect(mocks.contactLookup).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
}
function expectSafeWarning(method:'GET'|'POST',stage:string,code='UNKNOWN',kind='Error'){
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith('contact_request_error',expect.objectContaining({method,stage,code,kind,elapsedMs:expect.any(Number)}));
  const [event,details]=vi.mocked(console.warn).mock.calls[0] as [string,Record<string,unknown>];
  expect(event).toBe('contact_request_error');
  expect(Object.keys(details).every(key=>['method','stage','code','kind','sqlState','reason','elapsedMs'].includes(key))).toBe(true);
  const logged=JSON.stringify(vi.mocked(console.warn).mock.calls);
  for(const secret of ['private-player','private-session','private-session-cookie','private-db.example','private-password','private-bot-token','987654321','+251911111111'])expect(logged).not.toContain(secret);
}

beforeEach(()=>{
  vi.resetAllMocks();
  vi.stubEnv('BETTER_AUTH_URL',origin);
  mocks.launchSession.mockResolvedValue(snapshot());
  mocks.localPreview.mockReturnValue(false);
  for(const lookup of [mocks.contactStatus,mocks.userLookup,mocks.contactLookup])lookup.mockImplementation(()=>{throw new Error('Duplicate contact lookup must not run')});
  mocks.transaction.mockImplementation(()=>{throw new Error('Direct route transaction must not run')});
  mocks.requestLimit.mockResolvedValue(true);
  mocks.createBot.mockReturnValue({api:{sendMessage:mocks.sendMessage}});
  mocks.sendMessage.mockResolvedValue({message_id:1});
  vi.spyOn(console,'warn').mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()});

describe('contact route bound-session snapshot and safe diagnostics',()=>{
  it.each([true,false])('GET returns the validated %s contact snapshot without another database lookup',async verified=>{
    const session=snapshot(verified);mocks.launchSession.mockResolvedValue(session);
    const response=await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(session.contactStatus);
    expect(mocks.launchSession).toHaveBeenCalledTimes(1);
    expectNoContactLookup();expect(mocks.requestLimit).not.toHaveBeenCalled();expect(mocks.createBot).not.toHaveBeenCalled();
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('keeps the protected local-preview response separate from real contact data',async()=>{
    mocks.launchSession.mockResolvedValue({...snapshot(),user:{id:'lowin-local-test-user'},telegramId:null});
    mocks.localPreview.mockReturnValue(true);
    const response=await GET(request('GET'));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({verified:true,masked:null,fixture:true});
    expectNoContactLookup();expect(mocks.requestLimit).not.toHaveBeenCalled();expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('uses a fresh validated contact snapshot for each GET instead of retaining verification state',async()=>{
    mocks.launchSession.mockResolvedValueOnce(snapshot(false)).mockResolvedValueOnce(snapshot(true));
    const unverified=await GET(request('GET'));
    expect(unverified.status).toBe(200);expect(await unverified.json()).toEqual({verified:false,masked:null});
    const verified=await GET(request('GET'));
    expect(verified.status).toBe(200);expect(await verified.json()).toEqual({verified:true,masked:'•••• 1234'});
    expect(mocks.launchSession).toHaveBeenCalledTimes(2);
    expectNoContactLookup();expect(mocks.requestLimit).not.toHaveBeenCalled();expect(mocks.createBot).not.toHaveBeenCalled();
    expectPrivateTiming(unverified);expectPrivateTiming(verified);expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(['GET','POST'] as const)('%s rejects missing authentication without a database lookup or warning',async method=>{
    mocks.launchSession.mockResolvedValue(null);
    const response=await (method==='GET'?GET:POST)(request(method));
    expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'Reopen Lowwin from Telegram.'});
    expectNoContactLookup();expect(mocks.requestLimit).not.toHaveBeenCalled();expect(mocks.createBot).not.toHaveBeenCalled();
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('reports an initialization errorCode without exposing session, contact or connection data',async()=>{
    mocks.launchSession.mockRejectedValue(new Prisma.PrismaClientInitializationError(
      'postgresql://private-player:private-password@private-db.example/production +251911111111','6.19.3','P1001',
    ));
    const response=await GET(request('GET'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'This information is temporarily unavailable.'});
    expectSafeWarning('GET','session-read','P1001','PrismaClientInitializationError');
    expectNoContactLookup();expect(mocks.requestLimit).not.toHaveBeenCalled();expectPrivateTiming(response);
  });

  it('rejects an invalid mutation origin before reading any session or sending to the bot',async()=>{
    const response=await POST(request('POST','https://untrusted.example'));
    expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'Request origin is not allowed.'});
    expect(mocks.launchSession).not.toHaveBeenCalled();expectNoContactLookup();
    expect(mocks.requestLimit).not.toHaveBeenCalled();expect(mocks.createBot).not.toHaveBeenCalled();
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('rejects a missing mutation origin before reading any session or sending to the bot',async()=>{
    const response=await POST(new Request(`${origin}/api/onboarding/contact`,{method:'POST',headers:{cookie:'private-session-cookie'}}));
    expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'Request origin is not allowed.'});
    expect(mocks.launchSession).not.toHaveBeenCalled();expectNoContactLookup();
    expect(mocks.requestLimit).not.toHaveBeenCalled();expect(mocks.createBot).not.toHaveBeenCalled();expect(mocks.sendMessage).not.toHaveBeenCalled();
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('rejects a snapshot without a bound Telegram identity before requesting a contact',async()=>{
    mocks.launchSession.mockResolvedValue({...snapshot(),telegramId:null});
    const response=await POST(request('POST'));
    expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'A verified Telegram launch is required.'});
    expectNoContactLookup();expect(mocks.requestLimit).not.toHaveBeenCalled();expect(mocks.createBot).not.toHaveBeenCalled();
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns an already verified snapshot without rate limiting or sending another contact request',async()=>{
    mocks.launchSession.mockResolvedValue(snapshot(true));
    const response=await POST(request('POST'));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({verified:true});
    expectNoContactLookup();expect(mocks.requestLimit).not.toHaveBeenCalled();expect(mocks.createBot).not.toHaveBeenCalled();
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('checks the server-bound user with the limiter before sending to its bound Telegram identity',async()=>{
    const response=await POST(request('POST'));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({sent:true});
    expectNoContactLookup();expect(mocks.requestLimit).toHaveBeenCalledExactlyOnceWith(db,'private-player');
    expect(mocks.requestLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendMessage.mock.invocationCallOrder[0]);
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith('987654321',CONTACT_REQUEST_MESSAGE,{reply_markup:CONTACT_REPLY_KEYBOARD});
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns 429 without another bot message while the durable rate limit is active',async()=>{
    mocks.requestLimit.mockResolvedValue(false);
    const response=await POST(request('POST'));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({error:'Contact request already sent. Check the bot or retry in a minute.'});
    expectNoContactLookup();expect(mocks.requestLimit).toHaveBeenCalledExactlyOnceWith(db,'private-player');expect(mocks.createBot).not.toHaveBeenCalled();
    expectPrivateTiming(response);expect(console.warn).not.toHaveBeenCalled();
  });

  it('reports bot failure at its fixed stage without exposing the bot token or recipient',async()=>{
    mocks.sendMessage.mockRejectedValue(new Error('https://api.telegram.org/botprivate-bot-token/sendMessage recipient 987654321 +251911111111'));
    const response=await POST(request('POST'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'This information is temporarily unavailable.'});
    expectSafeWarning('POST','bot-send');expectNoContactLookup();expectPrivateTiming(response);
    expect(mocks.requestLimit).toHaveBeenCalledExactlyOnceWith(db,'private-player');
  });

  it('reports limiter failure at its fixed stage and never sends a bot request',async()=>{
    mocks.requestLimit.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('private-player private-password private-db.example',{
      code:'P2024',clientVersion:'6.19.3',
    }));
    const response=await POST(request('POST'));
    expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'This information is temporarily unavailable.'});
    expectSafeWarning('POST','rate-limit','P2024','PrismaClientKnownRequestError');
    expectNoContactLookup();expectPrivateTiming(response);expect(mocks.requestLimit).toHaveBeenCalledExactlyOnceWith(db,'private-player');
    expect(mocks.createBot).not.toHaveBeenCalled();expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
