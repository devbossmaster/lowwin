import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({
 session:vi.fn(),limit:vi.fn(),findInvite:vi.fn(),policy:vi.fn(),prepare:vi.fn(),schemaReady:vi.fn(),
}));
vi.mock('grammy',()=>({Api:class {
 savePreparedInlineMessage=fixture.prepare;
}}));
vi.mock('@/lib/db',()=>({db:{referralInvite:{findUnique:fixture.findInvite}}}));
vi.mock('@/lib/env',()=>({getEnv:()=>({
 TELEGRAM_BOT_TOKEN:'4000000:fixture_fake_bot_token',
 TELEGRAM_BOT_USERNAME:'lowwin_fixture_bot',
 MINI_APP_URL:'https://lowwin.shop',
})}));
vi.mock('@/lib/rate-limit',()=>({allowIdentityRequest:fixture.limit}));
vi.mock('@/modules/auth/mini-access',()=>({getMiniSession:fixture.session}));
vi.mock('@/modules/referrals/service',()=>({getReferralPolicy:fixture.policy,referralSchemaReady:fixture.schemaReady}));

import {POST} from '@/app/api/referrals/telegram-share/route';

const signedMiniSession={
 session:{telegramAuthSource:'MINI_APP',telegramLaunchId:'41000000'},
 telegramId:'41000000',user:{id:'owner-user'},
};
function request(body:unknown={language:'en'},origin='https://lowwin.shop'){
 return new Request('https://lowwin.shop/api/referrals/telegram-share',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body),
 });
}

beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubEnv('BETTER_AUTH_URL','https://lowwin.shop');
 fixture.session.mockResolvedValue(signedMiniSession);
 fixture.limit.mockResolvedValue(true);
 fixture.findInvite.mockResolvedValue({token:'aBcdEFg_Hij9'});
 fixture.policy.mockResolvedValue({enabled:true});
 fixture.schemaReady.mockReturnValue(true);
 fixture.prepare.mockResolvedValue({id:'prepared-message'});
});
afterEach(()=>vi.unstubAllEnvs());

describe('prepared Telegram referral card',()=>{
 it('uses the authenticated Telegram ID and the owner’s saved invite in a localized photo card',async()=>{
  const response=await POST(request({language:'am'}));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(await response.json()).toEqual({id:'prepared-message'});
  expect(fixture.limit).toHaveBeenCalledWith(expect.anything(),'telegram-referral-share','owner-user',8);
  expect(fixture.findInvite).toHaveBeenCalledWith({where:{userId:'owner-user'},select:{token:true}});
  expect(fixture.prepare).toHaveBeenCalledExactlyOnceWith(41000000,expect.objectContaining({
   type:'photo',title:'በLowWin ቁጥርዎን ይምረጡ',
   photo_url:'https://lowwin.shop/images/lowwin-referral-share-20261119.jpg',
   reply_markup:{inline_keyboard:[[{text:'LowWinን ይክፈቱ',url:'https://t.me/lowwin_fixture_bot?start=ref_aBcdEFg_Hij9'}]]},
  }),{allow_user_chats:true,allow_group_chats:true,allow_channel_chats:true});
 });
 it('rejects cross-origin callers before reading their session or requesting Telegram',async()=>{
  const response=await POST(request({language:'en'},'https://unrelated.example'));
  expect(response.status).toBe(403);
  expect(fixture.session).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
 });
 it('requires a verified Mini App launch and rejects an arbitrary invite or Telegram ID in the request',async()=>{
  fixture.session.mockResolvedValueOnce(null).mockResolvedValueOnce({...signedMiniSession,session:{telegramAuthSource:'BROWSER_OIDC'}});
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request())).status).toBe(403);
  expect((await POST(request({language:'en',telegramId:123,url:'https://other.example'}))).status).toBe(422);
  expect(fixture.prepare).not.toHaveBeenCalled();
 });
 it('checks throttling and referral availability before preparing a message',async()=>{
  fixture.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  fixture.policy.mockResolvedValueOnce({enabled:false});
  expect((await POST(request())).status).toBe(403);
  fixture.findInvite.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(403);
  expect(fixture.prepare).not.toHaveBeenCalled();
 });
});
