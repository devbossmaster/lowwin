import {describe,expect,it} from 'vitest';
import {defaultBidRangeStep,previewBidRange} from '../src/lib/bid-range';
const rules={minPoints:'1',maxPoints:'1000',stepPoints:'0.01',remainingSubmissions:100,ownBids:[]};

describe('explicit bid ranges',()=>{
 it('defaults to whole-number ranges and never invents an invalid auction increment',()=>{
  expect(defaultBidRangeStep('0.01')).toBe('1.00');expect(defaultBidRangeStep('0.03')).toBe('1.02');expect(defaultBidRangeStep('2.00')).toBe('2.00');
 });
 it('adds 1 through 4 as four numbers at step1 rather than301 amounts',()=>{
  expect(previewBidRange('1','4','1',[],rules)).toEqual({complete:true,count:4,step:'1.00',additions:['1.00','2.00','3.00','4.00'],numbers:['1.00','2.00','3.00','4.00'],error:null});
 });
 it('supports exact inclusive decimal ranges while enforcing the existing consecutive rule',()=>{
  expect(previewBidRange('1','1.02','0.01',[],rules).numbers).toEqual(['1.00','1.01','1.02']);
  expect(previewBidRange('1','1.03','0.01',[],rules).error).toBe('consecutive');
  expect(previewBidRange('1.03','1.03','0.01',[],{...rules,ownBids:[{amount:'1'},{amount:'1.01'},{amount:'1.02'}]}).error).toBe('consecutive');
 });
 it('rejects nonpositive, overprecision and auction-incompatible increments before generating',()=>{
  for(const step of ['0','-1','0.001','1e2',''])expect(previewBidRange('1','4',step,[],rules).error).toBe('step');
  expect(previewBidRange('1','4','0.03',[],{...rules,stepPoints:'0.02'}).error).toBe('step');
 });
 it('rejects reversed or unaligned endpoints without truncating the requested range',()=>{
  expect(previewBidRange('4','1','1',[],rules).error).toBe('range');
  expect(previewBidRange('1','4.50','1',[],rules).error).toBe('alignment');
  expect(previewBidRange('1.01','1.05','0.02',[],{...rules,stepPoints:'0.02'}).error).toBe('range');
 });
 it('applies actual remaining capacity before allocating arrays, including huge input',()=>{
  expect(previewBidRange('1','4','1',['10'],{...rules,remainingSubmissions:4})).toMatchObject({count:0,additions:[],error:'limit'});
  expect(previewBidRange('1','9999999999999999.99','0.01',[],rules)).toMatchObject({count:0,additions:[],error:'limit'});
 });
 it('does not silently remove duplicate selections or previously accepted numbers',()=>{
  expect(previewBidRange('1','4','1',['2'],rules).error).toBe('duplicate');
  expect(previewBidRange('1','4','1',[],{...rules,ownBids:[{amount:'3'}]}).error).toBe('duplicate');
 });
 it('keeps incomplete ranges idle and rejects invalid endpoint precision',()=>{
  expect(previewBidRange('1','','1',[],rules)).toMatchObject({complete:false,error:null,count:0});
  expect(previewBidRange('1.001','4','1',[],rules).error).toBe('precision');
 });
 it('keeps the auction maximum and endpoint bounds in the existing validator',()=>{
  expect(previewBidRange('0','4','1',[],rules).error).toBe('range');
  expect(previewBidRange('998','1001','1',[],rules).error).toBe('range');
 });
});
