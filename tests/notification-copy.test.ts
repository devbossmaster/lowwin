import {describe,it,expect} from 'vitest';
import {notificationCopy,notificationAge} from '../src/components/notification-copy';
import {defaultHomeCopy,resolveHomeCopy} from '../src/components/home-copy';

describe('notification display language',()=>{
 it('keeps the Lowwin update heading in the Mini App for both languages',()=>{
  const item={kind:'BROADCAST',title:'Lowwin update · የLowwin መረጃ',body:'A new auction is ready.'};
  expect(notificationCopy(item,'en')).toEqual({title:'Lowwin update',body:item.body});
  expect(notificationCopy(item,'am')).toEqual({title:'የLowwin መረጃ',body:item.body});
 });
 it('selects one language for new campaigns while keeping item and result links',()=>{
  const item={kind:'AUCTION_RESULT',title:'Auction finished · ጨረታው ተጠናቋል',body:'Item #42\nA winner has been announced.\nአሸናፊው ታውቋል።\nhttps://example.test/winners/42'};
  expect(notificationCopy(item,'en').body).toBe('Item #42\nA winner has been announced.\nhttps://example.test/winners/42');
  expect(notificationCopy(item,'am').body).toBe('Item #42\nአሸናፊው ታውቋል።\nhttps://example.test/winners/42');
  expect(notificationCopy({kind:'DEPOSIT_CREDITED',title:'',body:'ETB 1.97 credited\n1.97 ብር ገብቷል'},'am').body).toBe('1.97 ብር ገብቷል');
  expect(notificationCopy({kind:'BROADCAST',title:'',body:'Owner supplied\nmessage'},'am').body).toBe('Owner supplied\nmessage');
 });
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
 it('does not translate v4 cancellation into the legacy fee refund promise',()=>{
  const item={kind:'AUCTION_MINIMUM_CANCELLED',title:'Auction cancelled: participant minimum not met',body:'Auction cancelled. Accepted submission fees are non-refundable.'};
  expect(notificationCopy(item,'en').body).toBe(item.body);
  expect(notificationCopy(item,'am').body).toContain('አይመለስም');
  expect(notificationCopy(item,'am').body).not.toContain('ተመልሰዋል');
  expect(item.body).toBe('Auction cancelled. Accepted submission fees are non-refundable.');
 });
 it('does not introduce held money into the v4 completed result notice',()=>{
  const item={kind:'AUCTION_CLOSED',title:'Auction closed',body:'Your result is ready. The chosen number is not charged.'};
  expect(notificationCopy(item,'am').body).toContain('የመረጡት ቁጥር አይከፈልም');
  expect(notificationCopy(item,'am').body).not.toContain('የተለቀቀውን ገንዘብ');
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
