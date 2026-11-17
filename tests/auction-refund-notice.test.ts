import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {RefundStatus} from '../src/components/auction-refund-notice';
import {MiniLocaleProvider} from '../src/components/mini-locale';
import type {AuctionRefundView} from '../src/lib/auction-refund';
const view=(refund:AuctionRefundView,am=false)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:am?'am':'en',children:createElement(RefundStatus,{refund})}));
describe('honest original-funding refund progress',()=>{
 it('never describes a queued refund as completed or credits its planned amount',()=>{const html=view({status:'pending',cash:'99',bonus:'7',bonusExpired:'0',completedAt:null});expect(html).toContain('Returning your fees');expect(html).not.toContain('Refund completed');expect(html).not.toContain('99');expect(html).not.toContain('Bonus restored')});
 it('keeps committed cash, restored bonus and expired promotional value distinct',()=>{const html=view({status:'completed',cash:'2.50',bonus:'7.50',bonusExpired:'3',completedAt:new Date().toISOString()});expect(html).toContain('Refund completed');expect(html).toContain('2.50');expect(html).toContain('7.50');expect(html).toContain('Expired promotional credit was not converted to cash')});
 it('provides Amharic pending and completed messages',()=>{expect(view({status:'pending',cash:'0',bonus:'0',bonusExpired:'0',completedAt:null},true)).toContain('በመመለስ ላይ');expect(view({status:'completed',cash:'5',bonus:'0',bonusExpired:'0',completedAt:new Date().toISOString()},true)).toContain('ተመልሷል')});
});
