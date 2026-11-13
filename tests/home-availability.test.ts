import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}}),useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/'}));
vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=>createElement('a',{href},children)}));
vi.mock('../src/components/mini-header',()=>({MiniHeader:()=>null}));
vi.mock('../src/components/offline-retry',()=>({OfflineRetry:()=>null}));
vi.mock('../src/components/home-hero',()=>({HomeHero:({copy}:{copy:{headline:string}})=>createElement('section',{'data-home-hero':true},copy.headline)}));
vi.mock('../src/components/home-how-it-works',()=>({HomeHowItWorks:()=>createElement('section',{'data-how-it-works':true},'How bidding works')}));
vi.mock('../src/components/home-footer',()=>({HomeFooter:()=>createElement('footer',null,'Lowwin footer')}));
vi.mock('../src/components/home-categories',()=>({HomeCategories:({categories}:{categories:unknown[]})=>createElement('nav',{'data-categories':categories.length})}));
vi.mock('../src/components/home-auctions',()=>({homeAuctionHref:()=>'/','HomeAuctions':({initial}:{initial?:{items:{code:string}[]}})=>createElement('div',{'data-auction-feed':true},initial?.items.map(item=>createElement('span',{key:item.code},item.code)))}));
vi.mock('../src/components/winners-client-list',()=>({WinnersClientList:({initial}:{initial?:{items:{code:string}[]}})=>createElement('div',{'data-winners-feed':true},initial?.items.map(item=>createElement('span',{key:item.code},item.code)))}));
import {HomePageSections,type HomeData} from '../src/components/home-page-content';
import {MiniLocaleProvider,type MiniLanguage} from '../src/components/mini-locale';
const query={status:'live' as const,sort:'featured' as const,q:'',page:1};
const cached={managed:null,experience:null,media:null,serverNow:'2026-11-13T10:00:00Z',categories:[],auctions:{items:[{code:'SAVED-AUCTION'}]},winners:{items:[{code:'SAVED-WINNER'}]}} as unknown as HomeData;
const render=(props:Partial<React.ComponentProps<typeof HomePageSections>>={},language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(HomePageSections,{query,error:false,onRetry(){},...props})}));
describe('Home availability during a failed server refresh',()=>{
 it('retains the cold-loading layout until a result or error arrives',()=>{const html=render();expect(html).toContain('data-route-skeleton="home"');expect(html).not.toContain('data-home-unavailable');expect(html).not.toContain('data-home-hero')});
 it.each(['en','am'] as const)('keeps public guidance visible with truthful unavailable resources in %s',language=>{
  const html=render({error:true},language);expect(html).toContain('data-home-hero');expect(html).toContain('Small price. Big joy.');expect(html).toContain('data-how-it-works');expect(html).toContain('<footer>');
  expect(html).toContain('data-home-unavailable="auctions"');expect(html).toContain('data-home-unavailable="winners"');expect(html).not.toMatch(/data-route-skeleton|data-auction-feed|data-winners-feed|No live auctions|Confirmed winners will appear/);
  expect(html).toContain(language==='en'?'Live auctions are temporarily unavailable.':'ክፍት ጨረታዎችን ለጊዜው ማምጣት አልተቻለም።');expect(html.match(/<button\b/g)).toHaveLength(3);
 });
 it('preserves successful cached records during a refresh error',()=>{const html=render({view:cached,categories:cached.categories,auctions:cached.auctions,winners:cached.winners,error:true});expect(html).toContain('SAVED-AUCTION');expect(html).toContain('SAVED-WINNER');expect(html).not.toMatch(/data-home-unavailable|data-route-skeleton/)});
 it('retains an available cached section without inventing missing resources',()=>{const html=render({view:cached,categories:cached.categories,auctions:cached.auctions,error:true});expect(html).toContain('SAVED-AUCTION');expect(html).not.toContain('data-home-unavailable="auctions"');expect(html).toContain('data-home-unavailable="winners"');expect(html).not.toContain('data-winners-feed')});
});
