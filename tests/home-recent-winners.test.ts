import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {WinnersData} from '../src/components/winners-client-list';
type QueryOptions={pollMs:number;initialData?:WinnersData;enabled?:boolean};
const f=vi.hoisted(()=>({query:{data:null as WinnersData|null,error:'',status:'authenticated',fetching:false,isPlaceholderData:false,reload:vi.fn()},publicOptions:null as QueryOptions|null,privateOptions:null as QueryOptions|null,page:1,carousel:true,identityData:null as WinnersData|null,identityStatus:'guest',rendered:[] as WinnersData['items']}));
vi.mock('../src/components/public-query',()=>({usePublicQuery:(_url:string,options:QueryOptions)=>{f.publicOptions=options;return f.query}}));
vi.mock('../src/components/private-query',async original=>({...await original<typeof import('../src/components/private-query')>(),usePrivateQuery:(_url:string,options:QueryOptions)=>{
 f.privateOptions=options;
 return f.carousel?{...f.query,data:f.identityData,status:f.identityStatus}:f.query;
}}));
vi.mock('../src/components/mini-query-state',()=>({useMiniPage:()=>[f.page,vi.fn()]}));
vi.mock('../src/components/mini-locale',()=>({MiniPhrase:({en}:{en:string})=>createElement('span',null,en)}));
vi.mock('../src/components/winner-cards',()=>({WinnerCards:({items}:{items:WinnersData['items']})=>{f.rendered=items;return createElement('div',{'data-saved-winner-count':items.length},'Saved winner cards')}}));
vi.mock('../src/components/mini-route-skeleton',()=>({MiniRouteSkeleton:()=>createElement('div',{'data-winner-skeleton':true},'Loading winners')}));
import {WinnersClientList} from '../src/components/winners-client-list';
import {miniQueryPolicy} from '../src/components/mini-query-policy';
import {getMiniQueryClient} from '../src/components/private-query-cache';
import {loadPublicJson,publicQueryKey} from '../src/components/public-query-cache';
const saved={items:[{code:'winner-1'}],total:1,page:1,totalPages:1,allowDemo:false,serverNow:'2026-11-12T10:00:00.000Z'} as WinnersData;
const render=(carousel=true,initial?:WinnersData)=>{f.carousel=carousel;return renderToStaticMarkup(createElement<{carousel?:boolean;initial?:WinnersData}>(WinnersClientList,{carousel,initial}))};
beforeEach(()=>{f.query={data:saved,error:'',status:'authenticated',fetching:false,isPlaceholderData:false,reload:vi.fn()};f.publicOptions=null;f.privateOptions=null;f.page=1;f.identityData=null;f.identityStatus='guest';f.rendered=[];getMiniQueryClient().clear()});
afterEach(()=>{getMiniQueryClient().clear();vi.useRealTimers();vi.unstubAllGlobals()});

describe('Home recent winners retain public cards and refresh quietly',()=>{
 it('keeps saved cards visible without recurring loading feedback during background refresh',()=>{
  f.query.fetching=true;const html=render();expect(html).toContain('Saved winner cards');expect(html).toContain('data-winners-ready="true"');expect(html).toContain('data-winners-refreshing="true"');expect(html).not.toContain('Updating');expect(html).not.toContain('Loading winners');
 });
 it('still provides a truthful cold skeleton and a retryable cold error',()=>{
  f.query.data=null;f.query.fetching=true;expect(render()).toContain('Loading winners');f.query.error='Synthetic unavailable request';const html=render();expect(html).toContain('Could not load this page');expect(html).toContain('Retry');expect(html).not.toContain('Saved winner cards');
 });
 it('keeps cached cards and useful retry feedback after a failed refresh',()=>{
  f.query.error='Synthetic refresh failure';const html=render();expect(html).toContain('Saved winner cards');expect(html).toContain('Showing saved details. Refresh failed.');expect(html).toContain('Retry');expect(html).not.toContain('Loading winners');
 });
 it('preserves full Winners-page refresh behavior and avoids seeding a different page',()=>{
  f.query.fetching=true;expect(render(false)).toContain('Updating');expect(f.privateOptions?.pollMs).toBe(miniQueryPolicy('/api/results/winners').staleMs);f.page=2;render(false,saved);expect(f.privateOptions?.initialData).toBeUndefined();
 });
 it.each(['loading','authenticated'] as const)('ignores an old guest snapshot during %s session restoration and the first signed-in read',status=>{
  f.identityStatus=status;
  const html=render();
  expect(html).toContain('Loading winners');expect(html).not.toContain('Saved winner cards');
  expect(f.publicOptions?.enabled).toBe(false);
 });
 it('uses the signed-in winner list even when the guest snapshot has different winners',()=>{
  const banner='/api/media/155a36cf-cf33-4415-b45d-809e06b5c96b';
  const currentWinner=(phone:string,bannerPath:string|null=banner,version=1)=>({code:'new-winner',status:'closed',isDemo:false,result:{source:'SETTLED',outcome:'WINNER',publishedAt:saved.serverNow,winnerDisplay:'Verified winner',winnerPhoneMasked:phone,winnerBannerPath:bannerPath,winnerBannerVersion:version,winnerUsername:'protected-handle',winningPoints:'42',winnerPhotoPath:'/private-photo'}});
  f.identityData={...saved,items:[currentWinner('2519110***23')] as unknown as WinnersData['items']};
  render();expect(f.rendered[0].code).toBe('winner-1');
  f.identityStatus='authenticated';
  render();expect(f.rendered[0]).toMatchObject({code:'new-winner',result:{winnerDisplay:'Verified winner',winnerPhoneMasked:'2519110***23',winnerBannerPath:banner,winnerBannerVersion:1,winnerUsername:null,winningPoints:null,winnerPhotoPath:null}});
  f.identityData={...saved,items:[currentWinner('+251911222123',null,2)] as unknown as WinnersData['items']};
  render();expect(f.rendered[0].result).toMatchObject({winnerPhoneMasked:null,winnerBannerPath:null,winnerBannerVersion:2});
 });
 it('reuses the public artwork cache for guest visits and refreshes it on the winners schedule',async()=>{
  vi.useFakeTimers();vi.stubGlobal('window',{});render();const options=f.publicOptions!;expect(options.pollMs).toBe(miniQueryPolicy('/api/results/winners').staleMs);
  const client=getMiniQueryClient(),url='/api/results/recent-winners',http=vi.fn(async()=>Response.json(saved));vi.stubGlobal('fetch',http);
  const read=()=>client.fetchQuery({queryKey:publicQueryKey(url),queryFn:({signal})=>loadPublicJson(url,{signal}),staleTime:miniQueryPolicy(url).staleMs});
  await read();await vi.advanceTimersByTimeAsync(options.pollMs-1);await read();expect(http).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);await read();expect(http).toHaveBeenCalledTimes(2);
 });
});
