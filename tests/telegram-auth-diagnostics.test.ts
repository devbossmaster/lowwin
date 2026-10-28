import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {signedLaunch,TEST_TOKEN} from './helpers';

const mocks=vi.hoisted(()=>({
  transaction:vi.fn(),createAuth:vi.fn(),handler:vi.fn(),limit:vi.fn(),
  launchSession:vi.fn(),bindContact:vi.fn(),bootstrap:vi.fn(),
  tx:{$executeRaw:vi.fn(),session:{updateMany:vi.fn()}},
}));
vi.mock('../src/lib/db',()=>({db:{$transaction:mocks.transaction}}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:mocks.limit}));
vi.mock('../src/modules/auth/server',()=>({createAuth:mocks.createAuth}));
vi.mock('../src/modules/auth/staff-plugin',()=>({staffActions:[]}));
vi.mock('../src/modules/admin/rate-limit',()=>({staffRateLimit:vi.fn()}));
vi.mock('../src/modules/auth/own-contact',()=>({bindOwnContact:mocks.bindContact}));
vi.mock('../src/modules/auth/mini-access',()=>({getLaunchSession:mocks.launchSession}));
vi.mock('../src/modules/auth/mini-account',()=>({telegramBootstrap:mocks.bootstrap}));
import {handleAuth} from '../src/modules/auth/handler';

const origin='http://localhost:3000';
const launch=(initData=signedLaunch(),cookie?:string,requestOrigin=origin)=>handleAuth(new Request(`${origin}/api/auth/telegram/miniapp/signin`,{
  method:'POST',headers:{origin:requestOrigin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({initData}),
}));

beforeEach(()=>{
  vi.clearAllMocks();
  for(const [name,value] of Object.entries({
    NODE_ENV:'test',APP_ENV:'local',DATABASE_URL:'postgresql://fixture@127.0.0.1:5432/auth_diagnostics_test',
    DIRECT_URL:'postgresql://fixture@127.0.0.1:5432/auth_diagnostics_test',BETTER_AUTH_URL:origin,MINI_APP_URL:origin,
    BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,
    TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',
    DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false',REFERRAL_REWARDS_SCHEMA_READY:'false',
  }))vi.stubEnv(name,value);
  mocks.limit.mockReset().mockResolvedValue(true);
  mocks.launchSession.mockReset().mockResolvedValue(null);
  mocks.tx.$executeRaw.mockReset().mockResolvedValue(1);
  mocks.tx.session.updateMany.mockReset().mockResolvedValue({count:1});
  mocks.bindContact.mockReset().mockResolvedValue(undefined);
  mocks.bootstrap.mockReset().mockResolvedValue({ok:true,status:'contact-required',me:null});
  mocks.handler.mockReset().mockImplementation(async()=>Response.json({
    session:{id:'private-session',userId:'private-player'},user:{id:'private-player',name:'Private player'},
  },{headers:{'Set-Cookie':'private-issued-cookie'}}));
  mocks.createAuth.mockReset().mockReturnValue({handler:mocks.handler});
  mocks.transaction.mockReset().mockImplementation(async(task:(client:typeof mocks.tx)=>Promise<unknown>)=>task(mocks.tx));
  vi.spyOn(console,'warn').mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()});

describe('safe Telegram authentication diagnostics',()=>{
  it('forwards only server-verified photo metadata and the fresh contact snapshot on a resumed Telegram session',async()=>{
    const photo='https://t.me/i/userpic/320/verified.jpg',user={id:'private-player',name:'Private player',image:null};
    const contactStatus={verified:true,masked:'•••• 1234'};
    mocks.launchSession.mockResolvedValue({telegramId:'778899',user,session:{id:'private-session'},contactStatus});
    expect((await launch(signedLaunch({user:JSON.stringify({id:778899,first_name:'Private player',photo_url:photo})}),'private-cookie')).status).toBe(200);
    expect(mocks.bootstrap).toHaveBeenCalledWith(expect.anything(),user,'778899','private-session',photo,contactStatus);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('does not reuse a contact snapshot from a different signed Telegram identity',async()=>{
    mocks.launchSession.mockResolvedValue({telegramId:'991122',user:{id:'other-player',name:'Other player'},session:{id:'other-session'},contactStatus:{verified:true,masked:'•••• 1234'}});
    expect((await launch(signedLaunch({user:JSON.stringify({id:778899,first_name:'Private player'})}),'private-cookie')).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.bindContact).toHaveBeenCalledWith(mocks.tx,'private-player','778899');
    expect(mocks.bootstrap).toHaveBeenCalledWith(mocks.tx,{id:'private-player',name:'Private player'},'778899','private-session',null);
  });
  it('reports initialization errorCode before any session can be issued',async()=>{
    mocks.limit.mockRejectedValue(new Prisma.PrismaClientInitializationError('private connection credentials','6.19.3','P1001'));
    const response=await launch();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'Connection interrupted. Please retry.'});
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('Telegram sign-in unavailable',{
      stage:'launch-rate-limit',code:'P1001',kind:'PrismaClientInitializationError',elapsedMs:expect.any(Number),
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private');
    expect(mocks.createAuth).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('never logs arbitrary error fields or the signed launch',async()=>{
    const initData=signedLaunch();
    mocks.limit.mockRejectedValue({name:'private-name',code:'private-code',errorCode:'private-error-code',message:`private-message ${initData}`,meta:{code:'private-state'}});
    const response=await launch(initData,'private-cookie');
    expect(response.status).toBe(503);
    expect(console.warn).toHaveBeenCalledWith('Telegram sign-in unavailable',{
      stage:'launch-rate-limit',code:'UNKNOWN',kind:'Error',elapsedMs:expect.any(Number),
    });
    const logged=JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).not.toContain('private');expect(logged).not.toContain(initData);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('logs only a fixed reason for a pooler tenant failure with no Prisma code',async()=>{
    mocks.limit.mockRejectedValue(new Prisma.PrismaClientInitializationError('Error querying database: FATAL: Tenant private-project-reference not found','6.19.3'));
    const response=await launch();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'Connection interrupted. Please retry.'});
    expect(console.warn).toHaveBeenCalledWith('Telegram sign-in unavailable',{
      stage:'launch-rate-limit',code:'UNKNOWN',kind:'PrismaClientInitializationError',reason:'POOLER_TENANT_NOT_FOUND',elapsedMs:expect.any(Number),
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private');
    expect(response.headers.has('set-cookie')).toBe(false);expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['forged',signedLaunch({auth_date:'1'})])('rejects an invalid launch before database access',async initData=>{
    expect((await launch(initData)).status).toBe(401);
    expect(mocks.limit).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('keeps origin validation before database access',async()=>{
    expect((await launch(signedLaunch(),undefined,'https://untrusted.example')).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('identifies a failed session read without logging its cookie',async()=>{
    mocks.launchSession.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('private pool details',{code:'P2024',clientVersion:'6.19.3'}));
    expect((await launch(signedLaunch(),'private-cookie')).status).toBe(503);
    expect(console.warn).toHaveBeenCalledWith('Telegram sign-in unavailable',{
      stage:'session-read',code:'P2024',kind:'PrismaClientKnownRequestError',elapsedMs:expect.any(Number),
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not forward an issued cookie when account bootstrap fails',async()=>{
    mocks.bootstrap.mockRejectedValue(new Error('private account details'));
    const response=await launch();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'Connection interrupted. Please retry.'});
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('Telegram sign-in unavailable',{
      stage:'account-bootstrap',code:'UNKNOWN',kind:'Error',elapsedMs:expect.any(Number),
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private');
  });
});
