import {describe,it,expect} from 'vitest';
import {assess,candidate,type VerificationInput} from '../src/modules/payments/provider';

const at=new Date('2026-09-29T10:10:00Z');
const requestId='550e8400-e29b-41d4-a716-446655440000';
const input:VerificationInput={bank:'telebirr',reference:'DEL889NG4S',account:'0911111111',expectedCents:null,minCents:100n,maxCents:20000n,createdAt:new Date('2026-09-29T10:00:00Z'),expiresAt:new Date('2026-09-29T10:30:00Z'),attemptKey:'attempt-1'};
function completed(overrides:Record<string,unknown>={}){return {success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:'100.00',currency:'ETB',receiverAccount:'251911111111',referenceNumber:input.reference,timestamp:at.toISOString(),...overrides}]}}

describe('Verify.et authoritative evidence',()=>{
 it('credits only complete exact evidence and derives ETB cents',()=>expect(assess(completed(),input,at)).toMatchObject({matched:true,code:'VERIFIED',evidence:{amountCents:'10000'}}));
 it('never credits queued responses',()=>expect(assess({success:true,requestId,verification:{processingStatus:'queued',status:'pending',verified:false},data:[]},input,at)).toMatchObject({matched:false,processing:true,code:'PROCESSING'}));
 it.each([
  [{receiverAccount:'2519****1111'},'RECEIVER_UNPROVEN'],
  [{receiverAccount:undefined},'RECEIVER_UNPROVEN'],
  [{receiverAccount:'251922222222'},'RECEIVER_MISMATCH'],
  [{amount:'0.99'},'AMOUNT_MISMATCH'],
  [{amount:'200.01'},'AMOUNT_MISMATCH'],
  [{amount:'1.001'},'INVALID_AMOUNT'],
  [{currency:'USD'},'CURRENCY_MISMATCH'],
  [{timestamp:'2026-09-28T10:10:00Z'},'DATE_MISMATCH'],
  [{timestamp:undefined},'DATE_MISMATCH'],
  [{referenceNumber:'OTHERREF123'},'REFERENCE_MISMATCH'],
 ] as const)('rejects unproven evidence: %j', (change,code)=>expect(assess(completed(change),input,at)).toMatchObject({matched:false,code}));
 it('preserves CBE Receipt ID case and normalizes only legacy FT',()=>{
  expect(candidate('cbe','https://mbreciept.cbe.com.et/fHCxyExampleRcpt1')).toBe('fHCxyExampleRcpt1');
  expect(candidate('cbe','ft26example1')).toBe('FT26EXAMPLE1');
  expect(candidate('telebirr','transaction number: del889ng4s')).toBe('DEL889NG4S');
 });
 it('does not guess ambiguous identifiers',()=>expect(()=>candidate('cbe','Receipt ID: fHCxyExampleRcpt1; Receipt ID: fHCxyExampleRcpt2')).toThrow());
});
