import {describe,it,expect} from 'vitest';
import {notificationCopy,notificationAge} from '../src/components/notification-copy';
import {defaultHomeCopy,resolveHomeCopy} from '../src/components/home-copy';

describe('notification display language',()=>{
 it('switches known alerts without changing the stored English message',()=>{
  const item={kind:'BID_ACCEPTED',title:'Bid accepted',body:'Your accepted receipt is ready in My Bids.'};
  expect(notificationCopy(item,'am').title).toBe('ጨረታዎ ተቀብሏል');
  expect(notificationCopy(item,'en')).toEqual({title:item.title,body:item.body});
 });
 it('preserves DEMO labels for existing previews without a kind',()=>{
  expect(notificationCopy({title:'DEMO · Bid accepted',body:''},'am').title).toBe('DEMO · ጨረታዎ ተቀብሏል');
 });
 it('keeps v1 no-winner, v2 fallback and participant refunds distinct',()=>{
  const translate=(kind:string)=>notificationCopy({kind,title:'',body:''},'am');
  expect(translate('AUCTION_NO_WINNER').body).toContain('አልተመለሱም');
  expect(translate('AUCTION_MINIMUM_CANCELLED').body).toContain('ሁሉም የመግቢያ ክፍያዎች ተመልሰዋል');
  expect(translate('AUCTION_FALLBACK_WON').body).toContain('በመረጃ ቋቱ መጀመሪያ');
 });
 it('retains unfamiliar messages instead of inventing an outcome',()=>{
  const item={kind:'CUSTOM',title:'Owner announcement',body:'Specific announcement'};
  expect(notificationCopy(item,'am')).toEqual({title:item.title,body:item.body});
 });
 it('uses Amharic relative dates',()=>{
  const now=Date.parse('2026-09-29T12:00:00Z');
  expect(notificationAge('2026-09-29T12:00:00Z','am',now)).toBe('አሁን');
  expect(notificationAge('2026-09-29T11:00:00Z','am',now)).toBe(new Intl.RelativeTimeFormat('am-ET',{numeric:'auto'}).format(-1,'hour'));
 });
});
describe('home introduction',()=>{
 it('replaces retired copy in both languages while preserving Owner edits',()=>{
  expect(resolveHomeCopy({headline:'A little different wins.',lead:'Old showcase'})).toEqual(defaultHomeCopy);
  expect(resolveHomeCopy(null)).toEqual(defaultHomeCopy);
  const edited={headline:'Custom headline',lead:'Custom copy',headlineAm:'አዲስ ርዕስ',leadAm:'አዲስ መግለጫ'};
  expect(resolveHomeCopy(edited)).toEqual(edited);
  expect(defaultHomeCopy.lead.split('\n')).toHaveLength(3);
  expect(defaultHomeCopy.leadAm.split('\n')).toHaveLength(3);
 });
});
