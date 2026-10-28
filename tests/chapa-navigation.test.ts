import {afterEach,describe,expect,it,vi} from 'vitest';
import {prepareChapaNavigation} from '../src/lib/chapa-navigation';
afterEach(()=>vi.unstubAllGlobals());
const url='https://checkout.chapa.global/test/payment/hosted/TESTfixture';
describe('one-click hosted checkout handoff',()=>{
 it('uses Telegram openLink and opens only the validated URL after initialization',()=>{
  const openLink=vi.fn(),open=vi.fn();vi.stubGlobal('window',{Telegram:{WebApp:{openLink}},open});const nav=prepareChapaNavigation();expect(openLink).not.toHaveBeenCalled();expect(nav.open(url)).toBe(true);nav.cancel();expect(openLink).toHaveBeenCalledExactlyOnceWith(url);expect(open).not.toHaveBeenCalled();
 });
 it('reserves a browser tab during the Pay click and closes it if checkout creation fails',()=>{
  const replace=vi.fn(),close=vi.fn(),popup={opener:{},closed:false,location:{replace},close},open=vi.fn(()=>popup);vi.stubGlobal('window',{open});const nav=prepareChapaNavigation();expect(open).toHaveBeenCalledExactlyOnceWith('about:blank','_blank');expect(popup.opener).toBeNull();nav.cancel();expect(close).toHaveBeenCalledOnce();expect(replace).not.toHaveBeenCalled();
 });
 it('reuses the reserved tab, with a same-tab fallback when popups are blocked',()=>{
  const replace=vi.fn(),close=vi.fn(),assign=vi.fn();vi.stubGlobal('window',{open:()=>({opener:null,closed:false,location:{replace},close}),location:{assign}});const nav=prepareChapaNavigation();nav.open(url);nav.cancel();expect(replace).toHaveBeenCalledExactlyOnceWith(url);expect(close).not.toHaveBeenCalled();
  vi.stubGlobal('window',{open:()=>null,location:{assign}});prepareChapaNavigation().open(url);expect(assign).toHaveBeenCalledExactlyOnceWith(url);
 });
 it('never opens caller-controlled hosts, fragments, credentials or malformed URLs',()=>{
  const openLink=vi.fn();vi.stubGlobal('window',{Telegram:{WebApp:{openLink}}});for(const bad of ['https://evil.test/checkout','https://user:password@checkout.chapa.global/CHx',url+'#other',' '+url,'javascript:alert(1)'])expect(prepareChapaNavigation().open(bad)).toBe(false);expect(openLink).not.toHaveBeenCalled();
 });
});
