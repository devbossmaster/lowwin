import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AuctionCountdown} from '../src/components/auction-countdown';
import {MiniLocaleProvider} from '../src/components/mini-locale';

const serverNow='2026-11-11T10:00:00.000Z',receivedAt=Date.parse(serverNow),target='2026-11-11T10:58:59.000Z';
function firstRender(language:'en'|'am',display:'inline'|'compact'|'tiles',observedAt=receivedAt){
 return renderToString(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(AuctionCountdown,{target,serverNow,observedAt,label:'Ends',showLabel:false,...(display==='inline'?{variant:'inline' as const}:{tiles:display==='tiles'})})}));
}
afterEach(()=>vi.useRealTimers());

describe('countdown server and first hydration markup',()=>{
 it.each(['en','am'] as const)('keeps text, accessible labels and tile frames identical after hydration delay in %s',language=>{
  vi.useFakeTimers();
  for(const display of ['inline','compact','tiles'] as const){
   vi.setSystemTime(receivedAt+900);const serverHtml=firstRender(language,display);
   // Cross the exact second boundary that previously changed 59 to 58 and
   // compare complete markup, including aria-label and all flip tile faces.
   vi.setSystemTime(receivedAt+2100);expect(firstRender(language,display)).toBe(serverHtml);
   vi.setSystemTime(receivedAt+86400000);expect(firstRender(language,display)).toBe(serverHtml);
   vi.setSystemTime(receivedAt-86400000);expect(firstRender(language,display)).toBe(serverHtml);
   expect(serverHtml).toContain(language==='am'?'58 ደቂቃዎች 59 ሰከንዶች':'58 minutes 59 seconds');
  }
 });
 it('does not let client-only cache receipt timestamps change the serialized first frame',()=>{
  vi.useFakeTimers();vi.setSystemTime(receivedAt);const serverHtml=firstRender('en','compact',0);
  vi.setSystemTime(receivedAt+10000);expect(firstRender('en','compact',receivedAt+5000)).toBe(serverHtml);
 });
});
