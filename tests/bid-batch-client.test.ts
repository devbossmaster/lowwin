import {describe,it,expect} from 'vitest';
import {normalizeBidDraft,normalizePaymentPhone,previewBidFees,validateBidDraft} from '../src/lib/bid-batch-client';
const rules={minPoints:'1',maxPoints:null,stepPoints:'0.01',remainingSubmissions:100,ownBids:[]};
describe('batch entry feedback',()=>{
 it('normalizes equivalent decimals without floats or accepting extra precision',()=>{expect(['2','2.0','2.00'].map(normalizeBidDraft)).toEqual(['2.00','2.00','2.00']);for(const value of ['2.001','1e2','02','-1','NaN'])expect(normalizeBidDraft(value)).toBeNull()});
 it('rejects duplicates across accepted and draft entries',()=>{expect(validateBidDraft(['2','2.00'],rules).error).toBe('duplicate');expect(validateBidDraft(['2'],{...rules,ownBids:[{amount:'2.00'}]}).error).toBe('duplicate')});
 it('checks the whole consecutive run regardless of selection order',()=>{for(const values of [['1.04','1.01','1.03','1.02'],['1.02','1.04','1.01','1.03']])expect(validateBidDraft(values,rules).error).toBe('consecutive');expect(validateBidDraft(['1.04'],{...rules,ownBids:[{amount:'1.01'},{amount:'1.02'},{amount:'1.03'}]}).error).toBe('consecutive');expect(validateBidDraft(['1.01','1.02','1.03','1.05'],rules).error).toBeNull()});
 it('enforces remaining cap and exact bounds/step',()=>{expect(validateBidDraft(['2','3'],{...rules,remainingSubmissions:1}).error).toBe('limit');expect(validateBidDraft(['1.01'],{...rules,stepPoints:'0.02'}).error).toBe('range');expect(validateBidDraft(['3'],{...rules,maxPoints:'2'}).error).toBe('range')});
 it('includes a valid field value when combined for review',()=>{expect(validateBidDraft(['2.00','4.25'],rules)).toEqual({numbers:['2.00','4.25'],error:null})});
});
describe('submission fee preview',()=>{
 it('updates the total for the selected entry count with exact cents',()=>{
  expect(previewBidFees(1,'50')).toMatchObject({entryCount:1,grossTotal:'50.00',discountTotal:'0.00',total:'50.00',totalCents:'5000'});
  expect(previewBidFees(3,'50.25')).toMatchObject({grossTotal:'150.75',total:'150.75',totalCents:'15075'});
  expect(previewBidFees(100,'9999999999999999.99').totalCents).toBe('99999999999999999900');
 });
 it('applies a coupon once and does not apply it to an empty selection',()=>{
  expect(previewBidFees(3,'50','5')).toMatchObject({grossTotal:'150.00',discountTotal:'5.00',total:'145.00'});
  expect(previewBidFees(1,'50','50').total).toBe('0.00');
  expect(previewBidFees(0,'50','5')).toMatchObject({entryCount:0,grossTotal:'0.00',discountTotal:'0.00',total:'0.00',totalCents:'0'});
 });
 it('rejects impossible counts and unvalidated amounts rather than displaying invented totals',()=>{
  for(const count of [-1,1.5,101,NaN,Infinity])expect(()=>previewBidFees(count,'50')).toThrow();
  for(const [fee,discount] of [['-1','0'],['50','-1'],['50','50.01'],['50.001','0'],['50','5.001'],['NaN','0']])expect(()=>previewBidFees(2,fee,discount)).toThrow();
 });
});
describe('payment phone normalization',()=>{
 it('normalizes national and international formats without duplicating zero',()=>{for(const input of ['0911652904','911652904','251911652904','+251 911 652 904'])expect(normalizePaymentPhone(input)).toBe('251911652904');expect(normalizePaymentPhone('0713339196')).toBe('251713339196')});
 it('rejects mixed prefixes, letters and incomplete numbers',()=>{for(const input of ['+2510911652904','+251foo','0911652','251111652904'])expect(normalizePaymentPhone(input)).toBeNull()});
});
