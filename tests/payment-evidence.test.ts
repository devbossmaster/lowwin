import {describe,it,expect} from 'vitest';
import {assess,candidate,type VerificationInput} from '../src/modules/payments/provider';

const at=new Date('2026-09-29T10:10:00Z');
const requestId='550e8400-e29b-41d4-a716-446655440000';
const input:VerificationInput={bank:'telebirr',reference:'DEL889NG4S',account:'0911111111',expectedCents:null,minCents:100n,maxCents:20000n,createdAt:new Date('2026-09-29T10:00:00Z'),expiresAt:new Date('2026-09-29T10:30:00Z'),attemptKey:'attempt-1'};
function completed(overrides:Record<string,unknown>={}){return {success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:'100.00',currency:'ETB',receiverAccount:'251911111111',referenceNumber:input.reference,timestamp:at.toISOString(),...overrides}]}}

describe('Verify.et authoritative evidence',()=>{
 it('credits completed evidence in the ETB unit fixed by the channel policy',()=>expect(assess(completed(),input,at)).toMatchObject({matched:true,code:'VERIFIED',evidence:{amountCents:'10000',currency:'ETB',currencySource:'channel_policy'}}));
 it.each(['telebirr','cbe'] as const)('uses the ETB channel policy for omitted %s currency',bank=>{
  const request={...input,bank,account:bank==='telebirr'?input.account:'1000303997441',reference:bank==='telebirr'?input.reference:'fHCxyExampleRcpt1'};
  const payload=completed({bank,receiverAccount:request.account,referenceNumber:request.reference});
  Reflect.deleteProperty(payload.data[0],'currency');
  expect(assess(payload,request,at)).toMatchObject({matched:true,code:'VERIFIED',evidence:{amountCents:'10000',currency:'ETB',currencySource:'channel_policy'}});
 });
 it('treats an undefined currency field as omitted',()=>expect(assess(completed({currency:undefined}),input,at)).toMatchObject({matched:true,code:'VERIFIED',evidence:{currency:'ETB',currencySource:'channel_policy'}}));
 it.each([
  ['null',null],
  ['number',1],
  ['boolean',true],
  ['array',['ETB']],
  ['object',{value:'ETB'}],
 ['non-ETB string','USD'],
 ['empty string',''],
 ] as const)('ignores provider %s currency under the explicit ETB application policy',(_label,currency)=>{
  for(const bank of ['telebirr','cbe'] as const){
   const request={...input,bank,account:bank==='telebirr'?input.account:'1000303997441',reference:bank==='telebirr'?input.reference:'fHCxyExampleRcpt1'};
   const result=assess(completed({bank,currency,receiverAccount:request.account,referenceNumber:request.reference}),request,at);
   expect(result).toMatchObject({matched:true,code:'VERIFIED',evidence:{amountCents:'10000',currency:'ETB',currencySource:'channel_policy'}});
   expect(result.evidence).not.toHaveProperty('invalidFields');
  }
 });
 it('reports nested malformed fields by type, without exposing values',()=>{
  const result=assess(completed({settlementAccountMatch:{matched:'secret-receiver'}}),input,at);
  expect(result).toMatchObject({matched:false,code:'INCOMPLETE_EVIDENCE',evidence:{invalidFields:[{field:'data.0.settlementAccountMatch.matched',issue:'invalid_type',received:'string'}]}});
  expect(JSON.stringify(result)).not.toContain('secret-receiver');
 });
 it('never credits queued responses',()=>expect(assess({success:true,requestId,verification:{processingStatus:'queued',status:'pending',verified:false},data:[]},input,at)).toMatchObject({matched:false,processing:true,code:'PROCESSING'}));
 it('treats a failed provider status as terminal, without retrying it as queued',()=>expect(assess({success:false,requestId,verification:{processingStatus:'failed',status:'failed',verified:false},data:[]},input,at)).toMatchObject({matched:false,code:'UNCONFIRMED'}));
 it('accepts Verify.et approval of a masked match to the frozen account',()=>expect(assess(completed({receiverAccount:'2519****1111',settlementAccountMatch:{matched:true,matchType:'masked_pattern',ambiguous:false,matchedSettlementAccount:input.account,bank:'telebirr'}}),input,at)).toMatchObject({matched:true,code:'VERIFIED',evidence:{amountCents:'10000',receiverSuffix:'1111'}}));
 it('accepts the one-day boundary and rejects an older transfer',()=>{
  const oneDayInput={...input,createdAt:new Date(at.getTime()-86400000)};
  expect(assess(completed({timestamp:oneDayInput.createdAt.toISOString()}),oneDayInput,at).matched).toBe(true);
  expect(assess(completed({timestamp:new Date(oneDayInput.createdAt.getTime()-1000).toISOString()}),oneDayInput,at)).toMatchObject({matched:false,code:'DATE_MISMATCH'});
 });
 it.each([
  [{receiverAccount:'2519****1111'},'RECEIVER_UNPROVEN'],
  [{receiverAccount:'2519****1111',settlementAccountMatch:{matched:false,matchType:'unmatched',ambiguous:false,matchedSettlementAccount:input.account}},'RECEIVER_UNPROVEN'],
  [{receiverAccount:'2519****1111',settlementAccountMatch:{matched:true,matchType:'masked_pattern',ambiguous:true,matchedSettlementAccount:input.account}},'RECEIVER_UNPROVEN'],
  [{receiverAccount:'2519****2222',settlementAccountMatch:{matched:true,matchType:'masked_pattern',ambiguous:false,matchedSettlementAccount:input.account}},'RECEIVER_UNPROVEN'],
  [{receiverAccount:'2519****1111',settlementAccountMatch:{matched:true,matchType:'masked_pattern',ambiguous:false,matchedSettlementAccount:'0999999999'}},'RECEIVER_UNPROVEN'],
  [{receiverAccount:undefined},'RECEIVER_UNPROVEN'],
  [{receiverAccount:'251922222222'},'RECEIVER_MISMATCH'],
  [{amount:'0.99'},'AMOUNT_MISMATCH'],
  [{amount:'200.01'},'AMOUNT_MISMATCH'],
  [{amount:'1.001'},'INVALID_AMOUNT'],
  [{timestamp:'2026-09-28T10:10:00Z'},'DATE_MISMATCH'],
  [{timestamp:undefined},'DATE_MISMATCH'],
  [{referenceNumber:'OTHERREF123'},'REFERENCE_MISMATCH'],
 ] as const)('rejects unproven evidence: %j', (change,code)=>expect(assess(completed(change),input,at)).toMatchObject({matched:false,code}));
 it.each([
  [{receiverAccount:'251922222222'},'RECEIVER_MISMATCH'],
  [{receiverAccount:'2519****1111'},'RECEIVER_UNPROVEN'],
  [{referenceNumber:'OTHERREF123'},'REFERENCE_MISMATCH'],
  [{amount:'0.99'},'AMOUNT_MISMATCH'],
  [{amount:'1.001'},'INVALID_AMOUNT'],
  [{timestamp:'2026-09-28T10:10:00Z'},'DATE_MISMATCH'],
  [{timestamp:undefined},'DATE_MISMATCH'],
  [{verified:false},'UNCONFIRMED'],
 ] as const)('fixed ETB currency does not bypass other evidence checks: %j',(change,code)=>expect(assess(completed({currency:'USD',...change}),input,at)).toMatchObject({matched:false,code}));
 it('does not apply the ETB policy to unsupported banks',()=>expect(assess(completed({bank:'unsupported',currency:undefined}),input,at)).toMatchObject({matched:false,code:'INCOMPLETE_EVIDENCE'}));
 it('preserves CBE Receipt ID case and normalizes only legacy FT',()=>{
  expect(candidate('cbe','https://mbreciept.cbe.com.et/fHCxyExampleRcpt1')).toBe('fHCxyExampleRcpt1');
  expect(candidate('cbe','ft26example1')).toBe('FT26EXAMPLE1');
  expect(candidate('telebirr','transaction number: del889ng4s')).toBe('DEL889NG4S');
 });
 it('does not guess ambiguous identifiers',()=>expect(()=>candidate('cbe','Receipt ID: fHCxyExampleRcpt1; Receipt ID: fHCxyExampleRcpt2')).toThrow());
});
