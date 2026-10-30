import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';

vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:'verified-player'})}));
vi.mock('../src/components/mini-locale',()=>({MiniPhrase:({en}:{en:string})=>en,useMiniLocale:()=>({language:'en'})}));
vi.mock('../src/components/catalog-image',()=>({CatalogImage:({src,alt}:{src?:string;alt:string})=>createElement('img',{src,alt})}));
vi.mock('../src/components/account-sheet',()=>({AccountSheet:({title,children}:{title:ReactNode;children:ReactNode})=>createElement('section',{'data-test-sheet':true},createElement('h2',null,title),children)}));
// The content module is available with the card bundle. A lazy boundary here
// would render its partial preview instead of the complete entry form.
vi.mock('../src/components/bid-sheet-content',()=>({default:()=>createElement('form',{'data-complete-bid-entry':true},createElement('label',null,'Your bid amount'),createElement('input',{name:'amount'}),createElement('button',{type:'submit'},'Pay & bid'))}));

import BidSheet from '../src/components/bid-sheet';
import {BidSheetPreview,type BidSheetAuction} from '../src/components/bid-sheet-preview';

describe('Bid sheet entry loading',()=>{
 it('renders the complete contents immediately in its original sheet rather than a lazy preview',()=>{
  const auction={slug:'synthetic-auction',product:{title:'Synthetic item',images:[]}} as unknown as BidSheetAuction;
  const html=renderToStaticMarkup(createElement(BidSheet,{auction,serverNow:'2026-10-30T10:00:00Z',onClose:()=>{}}));
  expect(html.match(/data-test-sheet/g)).toHaveLength(1);
  expect(html).toContain('data-complete-bid-entry');
  expect(html).toContain('Your bid amount');
  expect(html).toContain('Pay &amp; bid');
  expect(html).not.toContain('Loading entry details');
 });
 it('can keep the product preview free of a duplicate status while preserving the default for other callers',()=>{
  const auction={slug:'synthetic-auction',status:'live',product:{title:'Synthetic item',images:[]}} as unknown as BidSheetAuction;
  const normal=renderToStaticMarkup(createElement(BidSheetPreview,{auction})),quiet=renderToStaticMarkup(createElement(BidSheetPreview,{auction,showStatus:false}));
  expect(normal).toContain('>Live</span>');expect(quiet).not.toContain('>Live</span>');expect(quiet).toContain('Synthetic item');
 });
});
