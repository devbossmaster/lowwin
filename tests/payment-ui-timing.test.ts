import {afterEach,describe,expect,it} from 'vitest';
import {beginPaymentUiTiming} from '../src/lib/payment-ui-timing';

afterEach(()=>performance.clearMeasures());
describe('local payment timings',()=>{
 it('records each truthful stage once and separates explicit code submission',()=>{
  const timer=beginPaymentUiTiming();timer.mark('feedback');timer.mark('feedback');timer.mark('request');timer.mark('authorization');timer.mark('code-confirmed');
  expect(performance.getEntriesByType('measure').map(e=>e.name)).toEqual(['lowwin:payment:tap-to-feedback','lowwin:payment:tap-to-request','lowwin:payment:tap-to-authorization']);
  timer.codeSubmitted();timer.mark('code-confirmed');timer.mark('confirmed');
  expect(performance.getEntriesByName('lowwin:payment:code-submit-to-confirmed')).toHaveLength(1);
  expect(performance.getEntriesByName('lowwin:payment:tap-to-confirmed')).toHaveLength(1);
 });
 it('bounds samples without including any payment or identity data',()=>{
  for(let i=0;i<83;i++)beginPaymentUiTiming().mark('feedback');
  const entries=performance.getEntriesByType('measure');expect(entries.length).toBeLessThanOrEqual(40);
  expect(entries.every(e=>e.name==='lowwin:payment:tap-to-feedback'&&(e as PerformanceMeasure).detail===null&&e.duration>=0)).toBe(true);
 });
});
