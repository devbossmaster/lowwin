import {describe,expect,it} from 'vitest';
import {formatEtb,legacyTermsInEtb,etbToCents,centsToEtb} from '../src/lib/money';

describe('1:1 ETB presentation of legacy integer ledger units',()=>{
 it('keeps cents exact through input, formatting and negative wallet history',()=>{
  for(const amount of ['1.97','2.34','9007199254740993.01','-0.01'])expect(centsToEtb(etbToCents(amount))).toBe(amount);
  expect(formatEtb('1.97')).toBe('ETB 1.97');expect(formatEtb('-0.03')).toBe('-ETB 0.03');
  for(const invalid of ['1.971','1e2','NaN','Infinity'])expect(()=>etbToCents(invalid)).toThrow();
 });
 it('preserves the integer amount and displays whole ETB',()=>{
  expect(formatEtb('1000')).toBe('ETB 1,000.00');
  expect(formatEtb(-3n)).toBe('-ETB 3.00');
 });
 it('converts immutable historic auction wording only for display',()=>{
  expect(legacyTermsInEtb('A 2 point fee; 1 point or 4 points can win.')).toBe('A ETB 2.00 fee; ETB 1.00 or ETB 4.00 can win.');
 });
});
