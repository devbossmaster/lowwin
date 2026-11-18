import {createElement,Suspense,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const calls=vi.hoisted(()=>({headers:vi.fn(),session:vi.fn(),find:vi.fn(),redirect:vi.fn()}));
vi.mock('next/headers',()=>({headers:calls.headers}));
vi.mock('next/navigation',()=>({redirect:calls.redirect,usePathname:()=>'/payments',useSearchParams:()=>new URLSearchParams()}));
vi.mock('../src/lib/db',()=>({db:{arifPayCheckout:{findFirst:calls.find}}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:calls.session}));
vi.mock('../src/components/chapa-payment-history',()=>({ChapaPaymentHistory:()=>createElement('button',null,'Top up')}));

import Payments from '../src/app/(mini)/payments/page';
import {ChapaPaymentHistory} from '../src/components/chapa-payment-history';
type Params=Record<string,string|string[]|undefined>;
type Stream={fallback:ReactElement;children:ReactElement<{searchParams:Promise<Params>}>};

beforeEach(()=>{vi.stubEnv('ARIFPAY_SCHEMA_READY','true');vi.clearAllMocks()});
afterEach(()=>{vi.unstubAllEnvs()});

describe('payments route streaming preserves early customer actions',()=>{
 it('never exposes a disposable Top up button while the legacy-return boundary is unresolved',async()=>{
  let release!:(value:Params)=>void;const params=new Promise<Params>(done=>{release=done});
  const page=Payments({searchParams:params}) as ReactElement<Stream>;
  expect(page.type).toBe(Suspense);
  const fallback=renderToStaticMarkup(page.props.fallback);
  expect(fallback).toContain('aria-busy="true"');expect(fallback).toContain('data-transactions-loading');
  expect(fallback).not.toMatch(/<button|<a\b|<input|data-transactions-page|Top up/);
  expect(calls.find).not.toHaveBeenCalled();expect(calls.session).not.toHaveBeenCalled();
  const child=page.props.children,resolve=child.type as (props:typeof child.props)=>Promise<ReactElement>;
  const ready=resolve(child.props);release({});const final=await ready;
  expect(final.type).toBe(ChapaPaymentHistory);expect(final.props).toEqual({fullPage:true});
  expect(calls.find).not.toHaveBeenCalled();expect(calls.session).not.toHaveBeenCalled();
 });
 it('keeps the ordinary history route unchanged when legacy returns are disabled',()=>{
  vi.stubEnv('ARIFPAY_SCHEMA_READY','false');const page=Payments({searchParams:Promise.resolve({})});
  expect(page.type).toBe(ChapaPaymentHistory);expect(page.props).toEqual({fullPage:true});
 });
 it('retains the owned historical return redirect after the noninteractive fallback resolves',async()=>{
  const id='11111111-1111-4111-8111-111111111111';calls.headers.mockResolvedValue(new Headers());calls.session.mockResolvedValue({user:{id:'owned-user'}});calls.find.mockResolvedValue({id,auction:{publicCode:987}});
  const page=Payments({searchParams:Promise.resolve({checkout:id})}) as ReactElement<Stream>,child=page.props.children,resolve=child.type as (props:typeof child.props)=>Promise<ReactElement>;
  await resolve(child.props);
  expect(calls.find).toHaveBeenCalledWith({where:{id,userId:'owned-user'},select:{id:true,auction:{select:{publicCode:true}}}});
  expect(calls.redirect).toHaveBeenCalledWith('/auctions/987?checkout='+id);
 });
});
