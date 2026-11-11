import {describe,expect,it} from 'vitest';
import {normalizePaymentPhone,paymentPhoneProblem,paymentPhoneProblemMessage} from '../src/lib/payment-phone';
describe('payment method phone validation',()=>{
 it.each(['0713339196','713339196','251713339196','+251713339196','+251 713 339 196'])('accepts M-Pesa format %s',phone=>{
  expect(normalizePaymentPhone(phone)).toBe('251713339196');expect(paymentPhoneProblem(phone,'mpesa')).toBeNull();
 });
 it.each(['0911652904','911652904','251911652904','+251 911 652 904'])('rejects an incompatible M-Pesa prefix %s',phone=>{
  expect(paymentPhoneProblem(phone,'mpesa')).toBe('mpesa_prefix');expect(paymentPhoneProblem(phone,'telebirr')).toBeNull();
 });
 it('rechecks the same number when switching wallet providers',()=>{
  expect(paymentPhoneProblem('0713339196','telebirr')).toBe('telebirr_prefix');
  for(const method of ['cbebirr','ebirr'])for(const phone of ['0713339196','0911652904'])expect(paymentPhoneProblem(phone,method)).toBeNull();
 });
 it.each(['','+2510911652904','+2519713','+251foo','07133391960','0811652904'])('rejects malformed or incomplete input %s',phone=>{
  for(const method of ['telebirr','mpesa','cbebirr'])expect(paymentPhoneProblem(phone,method)).toBe('invalid');
 });
 it.each(['0211652904','211652904','251211652904','+251 211 652 904','+251251911652904'])('never repairs an unsupported prefix or duplicated country code %s',phone=>{
  expect(normalizePaymentPhone(phone)).toBeNull();
  for(const method of ['telebirr','mpesa','cbebirr','ebirr'])expect(paymentPhoneProblem(phone,method)).toBe('invalid');
 });
 it('provides localized actionable messages without including the entered phone',()=>{
  expect(paymentPhoneProblemMessage('mpesa_prefix')).toContain('07 or +2517');
  expect(paymentPhoneProblemMessage('telebirr_prefix')).toContain('09 or +2519');
  for(const problem of ['invalid','mpesa_prefix','telebirr_prefix'] as const)expect(paymentPhoneProblemMessage(problem,true)).toMatch(/[\u1200-\u137f]/);
 });
});
