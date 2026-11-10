import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AuctionCountdown} from '../src/components/auction-countdown';
import {MiniLocaleProvider} from '../src/components/mini-locale';

const serverNow='2026-11-10T10:00:00.000Z',observedAt=Date.parse(serverNow),target=new Date(observedAt+2*86400000+4*3600000+18*60000+9000).toISOString();
function render(language:'en'|'am'='en',props:Partial<Parameters<typeof AuctionCountdown>[0]>={}){
 return renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(AuctionCountdown,{target,serverNow,observedAt,label:'Ends',showLabel:false,variant:'inline',...props})}));
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(observedAt)});
afterEach(()=>vi.useRealTimers());

describe('My Bids plain inline countdown under a mocked clock',()=>{
 it.each(['en','am'] as const)('renders one text node with accessible units in %s',language=>{
  const html=render(language);expect(html).toContain(language==='am'?'>2ቀ04:18:09</span>':'>2d04:18:09</span>');expect(html).toContain('role="timer"');expect(html).toContain('aria-live="off"');expect(html).toContain(language==='am'?'02 ቀናት 04 ሰዓታት 18 ደቂቃዎች 09 ሰከንዶች':'Ends in 02 days 04 hours 18 minutes 09 seconds');
  expect(html.match(/<span/g)).toHaveLength(1);for(const marker of ['data-countdown-tile','data-countdown-flip','data-countdown-unit','<small','<strong'])expect(html).not.toContain(marker);
 });
 it('subtracts cached receipt age instead of showing a fresh full duration',()=>{
  vi.setSystemTime(observedAt+10000);expect(render()).toContain('>2d04:17:59</span>');
 });
 it('ignores a device clock behind receipt time and clamps elapsed deadlines',()=>{
  vi.setSystemTime(observedAt-86400000);expect(render()).toContain('>2d04:18:09</span>');
  vi.setSystemTime(Date.parse(target)+60000);expect(render()).toContain('>Auction ended</span>');expect(render('am')).toContain('>ጨረታው አብቅቷል</span>');expect(render('en',{label:'Starts'})).toContain('>Starting now</span>');
 });
 it('retains the original four-unit markup for both existing tile variants',()=>{
  for(const tiles of [false,true]){const html=render('en',{variant:undefined,tiles});expect(html.match(/data-countdown-tile/g)).toHaveLength(4);expect(html.match(/data-countdown-unit/g)).toHaveLength(4);expect(html.match(/<small/g)).toHaveLength(4);expect(html).not.toContain('data-countdown-inline')}
 });
});
