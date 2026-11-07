import {describe,it,expect} from 'vitest';
import {normalizeBidDraft,normalizePaymentPhone,validateBidDraft} from '../src/lib/bid-batch-client';
const rules={minPoints:'1',maxPoints:null,stepPoints:'0.01',remainingSubmissions:100,ownBids:[]};
describe('batch entry feedback',()=>{
 it('normalizes equivalent decimals without floats or accepting extra precision',()=>{expect(['2','2.0','2.00'].map(normalizeBidDraft)).toEqual(['2.00','2.00','2.00']);for(const value of ['2.001','1e2','02','-1','NaN'])expect(normalizeBidDraft(value)).toBeNull()});
 it('rejects duplicates across accepted and draft entries',()=>{expect(validateBidDraft(['2','2.00'],rules).error).toBe('duplicate');expect(validateBidDraft(['2'],{...rules,ownBids:[{amount:'2.00'}]}).error).toBe('duplicate')});
 it('checks the whole consecutive run regardless of selection order',()=>{for(const values of [['1.04','1.01','1.03','1.02'],['1.02','1.04','1.01','1.03']])expect(validateBidDraft(values,rules).error).toBe('consecutive');expect(validateBidDraft(['1.04'],{...rules,ownBids:[{amount:'1.01'},{amount:'1.02'},{amount:'1.03'}]}).error).toBe('consecutive');expect(validateBidDraft(['1.01','1.02','1.03','1.05'],rules).error).toBeNull()});
 it('enforces remaining cap and exact bounds/step',()=>{expect(validateBidDraft(['2','3'],{...rules,remainingSubmissions:1}).error).toBe('limit');expect(validateBidDraft(['1.01'],{...rules,stepPoints:'0.02'}).error).toBe('range');expect(validateBidDraft(['3'],{...rules,maxPoints:'2'}).error).toBe('range')});
 it('includes a valid field value when combined for review',()=>{expect(validateBidDraft(['2.00','4.25'],rules)).toEqual({numbers:['2.00','4.25'],error:null})});
});
describe('payment phone normalization',()=>{
 it('normalizes national and international formats without duplicating zero',()=>{for(const input of ['0911652904','911652904','251911652904','+251 911 652 904'])expect(normalizePaymentPhone(input)).toBe('251911652904');expect(normalizePaymentPhone('0713339196')).toBe('251713339196')});
 it('rejects mixed prefixes, letters and incomplete numbers',()=>{for(const input of ['+2510911652904','+251foo','0911652','251111652904'])expect(normalizePaymentPhone(input)).toBeNull()});
});
