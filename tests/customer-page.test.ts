import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({session:vi.fn(),preview:vi.fn(()=>false),headers:vi.fn(()=>new Headers({cookie:'owned-session'})),auction:vi.fn(),result:vi.fn(),now:vi.fn(),legal:vi.fn(),experience:vi.fn(),category:vi.fn(),list:vi.fn()}));
vi.mock('next/headers',()=>({headers:f.headers}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{throw Error('REDIRECT '+href)},notFound:()=>{throw Error('NOT_FOUND')}}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:f.session,localMiniPreview:f.preview}));
vi.mock('../src/modules/auctions/catalog',()=>({getAuction:f.auction,getCategory:f.category,serverNow:f.now,listAuctions:f.list,listCategories:f.list}));
vi.mock('../src/modules/auctions/results',()=>({getPublicResult:f.result}));
vi.mock('../src/modules/admin/public-content',()=>({publicLegalContent:f.legal,publicHomeExperience:f.experience}));
vi.mock('../src/components/auction-detail',()=>({AuctionDetail:()=>null}));
vi.mock('../src/components/winner-result-route',()=>({WinnerResultRoute:()=>null}));
vi.mock('../src/components/help-pages',()=>({LegalPage:()=>null}));
vi.mock('../src/components/tutorial-content',()=>({TutorialContent:()=>null}));
vi.mock('../src/components/offline-retry',()=>({OfflineRetry:()=>null}));
vi.mock('../src/components/home-categories',()=>({HomeCategories:()=>null}));
import {browserAccountBootstrap,browserDocumentAccountBootstrap,requireCustomerPage} from '../src/modules/auth/customer-page';
import AuctionPage from '../src/app/(mini)/auctions/[slug]/page';
import ResultPage from '../src/app/(mini)/winners/[auctionCode]/page';
import Category from '../src/app/(mini)/categories/[slug]/page';
import Terms from '../src/app/(mini)/terms/page';
import Privacy from '../src/app/(mini)/privacy/page';
import FAQ from '../src/app/(mini)/faq/page';
import HowItWorks from '../src/app/(mini)/how-it-works/page';
beforeEach(()=>{vi.clearAllMocks();f.session.mockResolvedValue(null);f.preview.mockReturnValue(false);f.now.mockResolvedValue(new Date());f.auction.mockResolvedValue(null);f.result.mockResolvedValue(null)});
const pages=[
 ['/winners/42',()=>ResultPage({params:Promise.resolve({auctionCode:'42'})})],
 ['/terms',()=>Terms()],['/privacy',()=>Privacy()],['/faq',()=>FAQ()],['/how-it-works',()=>HowItWorks()],
] as const;
describe('server-rendered customer data authorization',()=>{
 it('returns not found for the retired browse path before reading auction data',async()=>{
  await expect(AuctionPage({params:Promise.resolve({slug:'all'}),searchParams:Promise.resolve({})})).rejects.toThrow('NOT_FOUND');
  expect(f.now).not.toHaveBeenCalled();expect(f.auction).not.toHaveBeenCalled();
 });
 it.each([
  ['42','closed','WINNER'],
  ['ledger-prize','closed','NO_WINNER'],
  ['42','cancelled','CANCELLED'],
 ])('redirects the published %s auction (%s, %s) straight to its result',async(slug,status,outcome)=>{
  f.session.mockResolvedValue({user:{id:'registered'}});
  f.auction.mockResolvedValue({code:'42',status,result:{source:'SETTLED',outcome}});
  await expect(AuctionPage({params:Promise.resolve({slug}),searchParams:Promise.resolve({})})).rejects.toThrow('REDIRECT /winners/42');
  expect(f.result).not.toHaveBeenCalled();
 });
 it('keeps an unpublished cancellation on the auction route while preserving an owned payment return link',async()=>{
  f.session.mockResolvedValue({user:{id:'registered'}});
  f.auction.mockResolvedValue({code:'42',status:'cancelled',result:null});
  await expect(AuctionPage({params:Promise.resolve({slug:'42'}),searchParams:Promise.resolve({})})).resolves.toBeTruthy();
  f.auction.mockResolvedValue({code:'42',status:'closed',result:{source:'SETTLED',outcome:'WINNER'}});
  const chapa='11111111-1111-4111-a111-111111111111';
  await expect(AuctionPage({params:Promise.resolve({slug:'ledger-prize'}),searchParams:Promise.resolve({chapa})})).rejects.toThrow('REDIRECT /auctions/42?chapa='+chapa);
  await expect(AuctionPage({params:Promise.resolve({slug:'42'}),searchParams:Promise.resolve({chapa})})).resolves.toBeTruthy();
  await expect(AuctionPage({params:Promise.resolve({slug:'42'}),searchParams:Promise.resolve({chapa:[chapa,chapa]})})).rejects.toThrow('REDIRECT /winners/42');
 });
 it.each(pages)('authorizes %s before reading or rendering protected content',async(path,render)=>{
  await expect(render()).rejects.toThrow('REDIRECT /?login=1&next='+encodeURIComponent(path));
  for(const read of [f.auction,f.result,f.category,f.now,f.legal,f.list,f.experience])expect(read).not.toHaveBeenCalled();
 });
 it.each(['MINI_APP','TELEGRAM_OIDC'])('uses verified %s proof, not the client presentation state',async source=>{
  const account={user:{id:'registered'},session:{telegramAuthSource:source}};f.session.mockResolvedValue(account);
  expect(await requireCustomerPage('/profile')).toBe(account);expect(f.session).toHaveBeenCalledWith(expect.any(Headers));
  await expect(ResultPage({params:Promise.resolve({auctionCode:'42'})})).rejects.toThrow('NOT_FOUND');
  expect(f.result).toHaveBeenCalledTimes(1);
 });
 it('propagates an auth outage instead of reading protected data or inventing logout',async()=>{
  f.session.mockRejectedValue(Error('database unavailable'));
  await expect(pages[0][1]()).rejects.toThrow('database unavailable');expect(f.result).not.toHaveBeenCalled();
 });
 it('keeps only the existing independently validated loopback preview exception',async()=>{
  f.preview.mockReturnValue(true);await expect(requireCustomerPage('/profile')).resolves.toEqual({preview:true});expect(f.session).not.toHaveBeenCalled();
 });
 it('projects browser restoration from a currently verified OIDC session without exposing credentials',async()=>{
  f.session.mockResolvedValue({user:{id:'owned-player',name:'Player',image:null},session:{id:'server-session-id',token:'private-token',telegramAuthSource:'TELEGRAM_OIDC'}});
  const result=await browserAccountBootstrap();
  expect(result).toEqual({kind:'verified',account:{sessionKey:expect.stringMatching(/^[a-f0-9]{64}$/),user:{id:'owned-player',name:'Player',image:null}}});
  expect(JSON.stringify(result)).not.toMatch(/private-token|server-session-id/);
 });
 it('distinguishes a missing session, non-browser proof and a retryable database error',async()=>{
  f.session.mockResolvedValueOnce(null).mockResolvedValueOnce({session:{telegramAuthSource:'MINI_APP'}}).mockRejectedValueOnce(Error('unavailable'));
  await expect(browserAccountBootstrap()).resolves.toEqual({kind:'guest'});
  await expect(browserAccountBootstrap()).resolves.toEqual({kind:'client-check'});
  await expect(browserAccountBootstrap()).resolves.toEqual({kind:'unavailable'});
 });
 it('skips guest restoration only for a document without a presented session',async()=>{
  const document=new Headers({'sec-fetch-dest':'document',cookie:'lowwin-language=am'});
  await expect(browserDocumentAccountBootstrap(document,true)).resolves.toEqual({kind:'guest'});
  expect(browserDocumentAccountBootstrap(new Headers(),false)).toBeUndefined();
  for(const name of ['better-auth.session_token','__Secure-better-auth.session_token']){
   document.set('cookie',`${name}=opaque-session-cookie`);
   expect(browserDocumentAccountBootstrap(document,false)).toBeUndefined();
  }
  expect(f.session).not.toHaveBeenCalled();
  await expect(browserDocumentAccountBootstrap(document,true)).resolves.toEqual({kind:'guest'});
  expect(f.session).toHaveBeenCalledTimes(1);
 });
});
