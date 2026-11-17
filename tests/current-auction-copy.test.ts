import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {termsDocument,faqEntries} from '../src/content/help-policy';
import {retiredAuctionPolicy} from '../src/content/current-auction-policy';
import {defaultHomeCopy,resolveHomeCopy} from '../src/components/home-copy';
import {AuctionRule,ResultExplanation} from '../src/components/auction-rule';
import {MiniLocaleProvider} from '../src/components/mini-locale';
import {botHelp} from '../src/content/bot-help';

describe('current auction and homepage policy copy',()=>{
 it('replaces old built-in campaign copy while retaining a genuinely custom campaign',()=>{
  for(const headline of ['Small price. Big joy.','A little different wins.'])expect(resolveHomeCopy({headline,lead:'Old campaign'})).toEqual(defaultHomeCopy);
  expect(resolveHomeCopy({headline:'A custom approved heading',lead:'Custom copy'})).toMatchObject({headline:'A custom approved heading',lead:'Custom copy'});
 });
 it('describes no-unique cancellation and actual net-fee funding boundaries in both languages',()=>{
  const document=JSON.stringify(termsDocument);expect(document).not.toMatch(/non-refundable|first accepted|fallback in section/i);
  const refunds=faqEntries.find(entry=>entry.id==='refund')!.answer;
  expect(refunds.en).toContain('Cash payments return as cash');expect(refunds.en).toContain('original expiry');expect(refunds.en).toContain('Coupon discounts');expect(refunds.am).toContain('ጥሬ ገንዘብ');expect(refunds.am).toContain('ኩፖን');
  expect(faqEntries.find(entry=>entry.id==='fallback')!.answer.en).toContain('A repeated number never wins');
 });
 it('recognizes retired managed policy so saved content cannot restore it',()=>{
  expect(retiredAuctionPolicy({en:'Accepted fees are non-refundable, including cancellation.'})).toBe(true);
  expect(retiredAuctionPolicy({en:'The earliest accepted bid at the lowest number wins.'})).toBe(true);
  expect(retiredAuctionPolicy(termsDocument)).toBe(false);
  expect(retiredAuctionPolicy({en:'Your first accepted bid may qualify for an invitation reward.'})).toBe(false);
 });
 it.each(['en','am'] as const)('keeps v5 cancellation honest about committed refund credits in %s',language=>{
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(ResultExplanation,{ruleVersion:'lowest-unique-v5',outcome:'CANCELLED',decision:'NO_UNIQUE_BID'})}));
  expect(html).toContain(language==='en'?'check Transactions for committed credits':'የተጠናቀቁ ተመላሾችን');expect(html).not.toContain('refunded');
 });
 it('preserves historical v4 rules while v5 cannot offer a repeated-bid winner',()=>{
  const render=(ruleVersion:string)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(AuctionRule,{ruleVersion})}));
  expect(render('lowest-unique-v4')).toContain('earliest accepted bid at the lowest number wins');
  expect(render('lowest-unique-v5')).not.toContain('earliest accepted');expect(render('lowest-unique-v5')).toContain('no repeated number can win');
 });
 it('keeps both bot help languages aligned without old hold or fallback promises',()=>{
  expect(botHelp.en).toContain('A repeated number never wins');expect(botHelp.en).toContain('Cash returns as cash');expect(botHelp.en).not.toMatch(/v3|is held|first accepted|no additional bid fee/);
  expect(botHelp.am).toContain('የተደገመ ቁጥር መቼም አያሸንፍም');expect(botHelp.am).toContain('ኩፖን');expect(botHelp.am).not.toContain('ትልቁ ጨረታዎ ብቻ ይያዛል');
 });
});
