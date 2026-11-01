import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({params:new URLSearchParams(),path:'',items:[] as Record<string,unknown>[]}));
vi.mock('../src/components/admin-query',()=>({AdminLink:({children,...props}:{children:ReactNode;href:string})=>createElement('a',props,children)}));
vi.mock('../src/components/admin-ui',()=>({
 AdminHeading:({title,description}:{title:string;description:string})=>createElement('header',null,createElement('h1',null,title),description),
 Empty:({title,children}:{title:string;children:ReactNode})=>createElement('p',null,title,children),ErrorNotice:()=>null,Pagination:()=>null,
 Status:({value}:{value:string})=>createElement('span',null,value),eat:()=>'',
 useQueueParams:()=>({params:f.params,page:1,set:()=>{}}),
 useAdminRead:(path:string)=>{f.path=path;return {loading:false,error:null,reload:()=>{},data:{configured:true,items:f.items,total:f.items.length,page:1,totalPages:1,serverNow:'2026-10-30T10:00:00Z'}}},
}));
import {AdminRecords} from '../src/components/admin-neutral-workspace';
const render=()=>renderToStaticMarkup(createElement(AdminRecords,{section:'transactions'}));
beforeEach(()=>{f.params=new URLSearchParams();f.items=[];f.path=''});
describe('clear admin payment views',()=>{
 it('opens completed records first and offers independent payment purpose filters',()=>{
  const html=render();expect(f.path).toContain('view=completed');expect(html).toContain('aria-current="page">Completed');
  for(const label of ['Unfinished','Needs review','Failed','All types','Wallet deposits','Bid payments'])expect(html).toContain(label);
 });
 it('keeps unfinished bid attempts pending even if a stale response includes the old session-ended flag',()=>{
  f.params=new URLSearchParams({view:'unfinished',purpose:'BID'});f.items=[{id:'attempt',purpose:'BID',typeLabel:'Bid payment attempt',createdAt:'2026-10-30T09:00:00Z',amount:'10',status:'PENDING',creditApplied:false,sessionEnded:true}];
  const html=render();expect(f.path).toContain('view=unfinished');expect(f.path).toContain('purpose=BID');expect(html).toContain('Bid payment attempt');expect(html).toContain('Requested amount');expect(html).toContain('>PENDING<');expect(html).not.toContain('Session ended');expect(html).not.toContain('>FAILED<');
 });
 it('keeps committed review payments visible with their review outcome',()=>{
  f.params=new URLSearchParams({view:'review'});f.items=[{id:'preserved',purpose:'BID',typeLabel:'Bid payment',createdAt:'2026-10-30T09:00:00Z',amount:'10',status:'NEEDS_REVIEW',creditApplied:true,sessionEnded:false}];
  const html=render();expect(html).toContain('Bid payment');expect(html).toContain('NEEDS_REVIEW');expect(html).not.toContain('Requested amount');expect(html).not.toContain('Session ended');
 });
 it('shows wallet fee payments alongside Chapa deposits with an explicit method column',()=>{
  f.items=[{id:'wallet-bid',source:'wallet',provider:'Wallet',channel:'Wallet',purpose:'BID',typeLabel:'Bid payment',amount:'45',status:'BID_ACCEPTED',creditApplied:true,createdAt:'2026-11-01T10:00:00Z'},{id:'chapa-deposit',source:'chapa',provider:'Chapa',channel:'telebirr',purpose:'TOP_UP',typeLabel:'Wallet deposit',amount:'100',status:'CREDITED',creditApplied:true,createdAt:'2026-11-01T09:00:00Z'}];
  const html=render();expect(html).toContain('aria-label="Payments"');expect(html).toContain('<th>Method</th>');
  expect(html).toContain('<strong>Wallet</strong>');expect(html).toContain('<strong>Chapa</strong>');expect(html).toContain('telebirr');
  expect(html).toContain('Bid payment');expect(html).toContain('Wallet deposit');expect(html).toContain('45.00');expect(html).not.toContain('Requested amount');
 });
});
