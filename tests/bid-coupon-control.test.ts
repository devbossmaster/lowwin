import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({query:{status:'authenticated',data:null as null|{configured:boolean;available:number|null},error:'',fetching:false,reload:vi.fn()}}));
vi.mock('../src/components/private-query',()=>({usePrivateQuery:()=>state.query}));
import {BidCouponControl} from '../src/components/bid-coupon-control';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=(am=false,applyCoupon=false)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:am?'am':'en',children:createElement(BidCouponControl,{applyCoupon,disabled:false,onChange:()=>{}})}));
beforeEach(()=>{state.query={status:'authenticated',data:null,error:'',fetching:false,reload:vi.fn()}});
describe('immediate private coupon control',()=>{
 it('reserves a truthful unknown row while the light account count loads',()=>{const html=render();expect(html).toContain('data-bid-coupons');expect(html).toContain('aria-busy="true"');expect(html).toContain('Loading coupon count');expect(html).toContain('>—</b>');expect(html).not.toContain('>0</b>');expect(html).toContain('disabled=""')});
 it('uses a confirmed exact count and preserves Remove when a coupon is selected',()=>{state.query.data={configured:true,available:3};const html=render();expect(html).toContain('>3</b>');expect(html).not.toContain('disabled=""');expect(render(false,true)).toContain('>Remove</button>');expect(render(true)).toContain('ኩፖኖች')});
 it('offers a lightweight retry instead of fabricating a count on errors',()=>{state.query.error='offline';const html=render();expect(html).toContain('>Retry</button>');expect(html).toContain('>—</b>');expect(html).not.toContain('>0</b>')});
 it('hides private data for guests and unconfigured rewards',()=>{state.query.status='guest';expect(render()).toBe('');state.query.status='authenticated';state.query.data={configured:false,available:null};expect(render()).toBe('')});
});
