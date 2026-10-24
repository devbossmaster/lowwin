import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({session:vi.fn(),user:vi.fn(),state:vi.fn(),submit:vi.fn(),limit:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:fixture.session}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:fixture.user,limitUserMutation:fixture.limit}));
vi.mock('../src/modules/auctions/bids',async original=>({...await original<typeof import('../src/modules/auctions/bids')>(),getOwnBidState:fixture.state,submitBid:fixture.submit}));
import {GET as state,POST as bid} from '../src/app/api/auctions/[slug]/bids/route';
import {GET as preview} from '../src/app/api/wallet/preview/route';
import {readMiniAccount} from '../src/modules/auth/mini-account';
const context={params:Promise.resolve({slug:'fixture-auction'})};
const request=(method='GET',origin='https://lowin.example')=>new Request('https://lowin.example/api/auctions/fixture-auction/bids',{method,headers:{origin}});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('BETTER_AUTH_URL','https://lowin.example');fixture.session.mockResolvedValue({user:{id:'registered-player'}});fixture.user.mockResolvedValue('registered-player');fixture.state.mockResolvedValue({open:true,terms:{ruleVersion:'lowest-unique-v4'},wallet:{available:'100000',held:'100'},previousMax:'100'})});
afterEach(()=>vi.unstubAllEnvs());
describe('legacy wallet spending and funding stay disabled',()=>{
 it('rejects balance-funded bid submissions even when an account has money',async()=>{
  const response=await bid(request('POST'),context);expect(response.status).toBe(410);expect(await response.json()).toMatchObject({code:'ARIFPAY_REQUIRED'});expect(fixture.submit).not.toHaveBeenCalled();expect(fixture.state).not.toHaveBeenCalled();
 });
 it('retains sign-in and origin checks before rejecting retired writes',async()=>{
  fixture.session.mockResolvedValueOnce(null);expect((await bid(request('POST'),context)).status).toBe(401);
  expect((await bid(request('POST','https://untrusted.example'),context)).status).toBe(403);expect(fixture.submit).not.toHaveBeenCalled();
 });
 it('exposes direct checkout state without balances or holds',async()=>{
  const response=await state(request(),context),body=await response.json();expect(response.status).toBe(200);expect(body.paymentMode).toBe('ARIFPAY');expect(body).not.toHaveProperty('wallet');expect(body).not.toHaveProperty('previousMax');expect(fixture.state.mock.calls[0].at(-1)).toBe(false);
 });
 it('does not reinterpret older frozen auctions as direct-fee auctions',async()=>{
  fixture.state.mockResolvedValueOnce({terms:{ruleVersion:'lowest-unique-v3'}});expect(await (await state(request(),context)).json()).toMatchObject({paymentMode:'LEGACY_READ_ONLY'});
 });
 it.each([preview])('keeps legacy funding details disabled with private cache headers',async handler=>{
  const response=await handler(request());expect(response.status).toBe(410);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toMatchObject({code:'WALLETS_RETIRED'});
 });
 it('returns the same registered identity without initializing or reading a wallet',async()=>{
  const ledger=vi.fn(()=>{throw Error('No ledger query expected during account refresh')}),initialize=vi.fn();
  const client={playerProfile:{findUnique:vi.fn(async()=>({displayName:'Existing customer'}))},ledgerAccount:{findMany:ledger},$transaction:initialize};
  const account=await readMiniAccount(client as never,{id:'registered-player',name:'Original name'},'same-session');
  expect(account.user).toMatchObject({id:'registered-player',name:'Existing customer'});expect(account.sessionKey).toHaveLength(64);expect(account).not.toHaveProperty('wallet');expect(ledger).not.toHaveBeenCalled();expect(initialize).not.toHaveBeenCalled();
 });
});
