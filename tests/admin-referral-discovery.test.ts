import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const f=vi.hoisted(()=>({permissions:['settings'] as string[],schemaReady:true}));
vi.mock('../src/components/admin-shell',()=>({useAdminAccess:()=>({role:'OWNER',permissions:f.permissions})}));
vi.mock('../src/components/admin-query',()=>({AdminLink:({children,...props}:{children:ReactNode;href:string})=>createElement('a',props,children)}));
vi.mock('../src/components/admin-ui',()=>({
 AdminHeading:({title,children}:{title:string;children:ReactNode})=>createElement('header',null,createElement('h1',null,title),children),
 ErrorNotice:()=>null,Empty:()=>null,Pagination:()=>null,Status:()=>null,eat:()=>'',
 useQueueParams:()=>({params:new URLSearchParams(),page:1,set:()=>{}}),
 useAdminRead:(path:string)=>({loading:false,error:null,reload:()=>{},data:path==='referrals'?{schemaReady:f.schemaReady,policy:{configured:false,enabled:false,version:0,discountPercent:10,expiryDays:30,updatedAt:null}}:null}),
 useAdminMutation:()=>({busy:false,error:null,message:null,clear:()=>{},run:async()=>null}),
}));
import {AdminPeople} from '../src/components/admin-people';
import {AdminReferralPolicy} from '../src/components/admin-referral-policy';

beforeEach(()=>{f.permissions=['settings'];f.schemaReady=true});
describe('discoverable guarded referral setup',()=>{
 it('links from the Players heading only for settings administrators',()=>{
  const render=()=>renderToStaticMarkup(createElement(AdminPeople,{section:'users'}));
  expect(render()).toContain('href="/admin/users/referrals"');expect(render()).toContain('Referral rewards setup');
  f.permissions=[];expect(render()).not.toContain('href="/admin/users/referrals"');
 });
 it('shows the activation checkbox for a ready schema before any policy is saved',()=>{
  const html=renderToStaticMarkup(createElement(AdminReferralPolicy));
  expect(html).toContain('Allow new referral rewards');expect(html).toContain('type="checkbox" name="enabled"');expect(html).not.toContain('<fieldset disabled=');
 });
 it('keeps the same checkbox visible but disabled until referral storage is configured',()=>{
  f.schemaReady=false;const html=renderToStaticMarkup(createElement(AdminReferralPolicy));
  expect(html).toContain('Allow new referral rewards');expect(html).toContain('<fieldset disabled=');expect(html).toContain('REFERRAL_REWARDS_SCHEMA_READY=true');
 });
});
