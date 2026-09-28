import {describe,expect,it} from 'vitest';
import {formatEtb,legacyTermsInEtb} from '../src/lib/money';

describe('1:1 ETB presentation of legacy integer ledger units',()=>{
 it('preserves the integer amount and displays whole ETB',()=>{
  expect(formatEtb('1000')).toBe('ETB 1,000.00');
  expect(formatEtb(-3n)).toBe('-ETB 3.00');
 });
 it('converts immutable historic auction wording only for display',()=>{
  expect(legacyTermsInEtb('A 2 point fee; 1 point or 4 points can win.')).toBe('A ETB 2.00 fee; ETB 1.00 or ETB 4.00 can win.');
 });
});
