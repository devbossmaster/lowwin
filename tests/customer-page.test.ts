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
vi.mock('../src/components/catalog-auction-list',()=>({CatalogAuctionList:()=>null}));
vi.mock('../src/components/home-categories',()=>({HomeCategories:()=>null}));
vi.mock('../src/components/auction-sort-links',()=>({AuctionSortLinks:()=>null}));
import {requireCustomerPage} from '../src/modules/auth/customer-page';
import AuctionPage from '../src/app/(mini)/auctions/[slug]/page';
import ResultPage from '../src/app/(mini)/winners/[auctionCode]/page';
import AllAuctions from '../src/app/(mini)/auctions/all/page';
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
});
