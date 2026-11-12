import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {WinnersData} from '../src/components/winners-client-list';
const f=vi.hoisted(()=>({query:{data:null as WinnersData|null,error:'',status:'authenticated',fetching:false,isPlaceholderData:false,reload:vi.fn()},options:null as {pollMs:number;freshnessMs:number;initialData?:WinnersData}|null,page:1}));
vi.mock('../src/components/public-query',()=>({usePublicQuery:(_url:string,options:NonNullable<typeof f.options>)=>{f.options=options;return f.query}}));
vi.mock('../src/components/mini-query-state',()=>({useMiniPage:()=>[f.page,vi.fn()]}));
vi.mock('../src/components/mini-locale',()=>({MiniPhrase:({en}:{en:string})=>createElement('span',null,en)}));
vi.mock('../src/components/winner-cards',()=>({WinnerCards:({items}:{items:unknown[]})=>createElement('div',{'data-saved-winner-count':items.length},'Saved winner cards')}));
vi.mock('../src/components/mini-route-skeleton',()=>({MiniRouteSkeleton:()=>createElement('div',{'data-winner-skeleton':true},'Loading winners')}));
import {WinnersClientList} from '../src/components/winners-client-list';
import {miniQueryPolicy} from '../src/components/mini-query-policy';
import {getMiniQueryClient} from '../src/components/private-query-cache';
import {loadPublicJson,publicQueryKey} from '../src/components/public-query-cache';
const saved={items:[{code:'winner-1'}],total:1,page:1,totalPages:1,allowDemo:false,serverNow:'2026-11-12T10:00:00.000Z'} as WinnersData;
const render=(carousel=true,initial?:WinnersData)=>renderToStaticMarkup(createElement<{carousel?:boolean;initial?:WinnersData}>(WinnersClientList,{carousel,initial}));
beforeEach(()=>{f.query={data:saved,error:'',status:'authenticated',fetching:false,isPlaceholderData:false,reload:vi.fn()};f.options=null;f.page=1;getMiniQueryClient().clear()});
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
  f.query.fetching=true;expect(render(false)).toContain('Updating');expect(f.options).toMatchObject({pollMs:30000,freshnessMs:10000});f.page=2;render(false,saved);expect(f.options?.initialData).toBeUndefined();
 });
 it('uses the existing historical freshness for Home and reuses repeated cached navigation',async()=>{
  vi.useFakeTimers();vi.stubGlobal('window',{});render();const options=f.options!;expect(options.pollMs).toBe(miniQueryPolicy('/api/results/winners?page=1').staleMs);expect(options.freshnessMs).toBe(300000);
  const client=getMiniQueryClient(),url='/api/results/winners?page=1',http=vi.fn(async()=>Response.json(saved));vi.stubGlobal('fetch',http);
  const read=()=>client.fetchQuery({queryKey:publicQueryKey(url),queryFn:({signal})=>loadPublicJson(url,{signal}),staleTime:options.freshnessMs});
  await read();for(let visit=0;visit<9;visit++){await vi.advanceTimersByTimeAsync(30000);await read()}expect(http).toHaveBeenCalledOnce();
  await client.invalidateQueries({queryKey:publicQueryKey(url)});await read();expect(http).toHaveBeenCalledTimes(2);
 });
});
