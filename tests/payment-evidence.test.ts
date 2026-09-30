import {describe,it,expect} from 'vitest';
import {assess,recoverProviderDuplicate,type VerificationInput} from '../src/modules/payments/provider';
const now=new Date('2026-09-29T10:10:00Z');
const input:VerificationInput={bank:'telebirr',reference:'DEL889NG4S',account:'0911111111',expectedCents:10000n,createdAt:new Date('2026-09-29T10:00:00Z'),expiresAt:new Date('2026-09-29T10:30:00Z')};
function evidence(){return {success:true,exists:true,duplicate:false,data:{bank:'telebirr',transaction_number:input.reference,verification_method:'official',receipt:{status:'completed',transaction_type:'transfer',amount:'100.00',currency:'ETB',transaction_date:now.toISOString(),receiver_account:input.account}}}}
describe('official payment evidence',()=>{
 it('accepts only the complete exact evidence',()=>{expect(assess(evidence(),input,now).matched).toBe(true)});
 it('derives the amount only inside frozen receipt limits and still verifies all evidence',()=>{
  const automatic={...input,expectedCents:null,minCents:100n,maxCents:20000n};
  expect(assess(evidence(),automatic,now)).toMatchObject({matched:true,evidence:{amountCents:'10000'}});
  expect(assess(evidence(),{...automatic,minCents:10001n},now).matched).toBe(false);
  expect(assess(evidence(),{...automatic,maxCents:9999n},now).matched).toBe(false);
  expect(assess(evidence(),{...automatic,minCents:undefined},now).matched).toBe(false);
  for(const change of [{receiver_account:'0999999999'},{currency:'USD'},{transaction_type:''},{transaction_date:'2026-09-29T11:00:00Z'},{amount:'1.001'}]){
   const body=evidence();Object.assign(body.data.receipt,change);expect(assess(body,automatic,now).matched).toBe(false);
  }
 });
 it('routes provider duplicates to review even with matching official evidence',()=>{expect(assess({...evidence(),duplicate:true},input,now)).toMatchObject({matched:false,code:'DUPLICATE_REVIEW'})});
 it('fails closed when duplicate or transfer type is unknown',()=>{
  const raw:Record<string,unknown>=evidence();delete raw.duplicate;expect(assess(raw,input,now).matched).toBe(false);
  const other=evidence();delete (other.data.receipt as Partial<typeof other.data.receipt>).transaction_type;expect(assess(other,input,now).matched).toBe(false);
 });
 it('recovers only the exact original API verification after a recorded timeout',async()=>{
  const prior=new Date('2026-09-29T10:09:30Z');
  const candidate={...evidence(),duplicate:true,existing_verification_id:42,verified_at:'2026-09-29T10:09:40Z'};
  const original={verification:{id:42,bank:'telebirr',transaction_number:input.reference,account_number:null,success:true,exists:true,status:'completed',transaction_type:'transfer',amount:'100.00',currency:'ETB',transaction_date:now.toISOString(),created_at:'2026-09-29T10:09:35Z',source:{type:'api',label:'Lowwin'}}};
  const check=(body:unknown=candidate,record:unknown=original,options:VerificationInput={...input,outageAttemptAt:prior})=>recoverProviderDuplicate(body,options,async()=>record,now);
  expect(await check()).toMatchObject({code:'VERIFIED_RECOVERED',matched:true,evidence:{originalVerificationId:42,recoveryCheck:'MATCHED',receiverSuffix:'1111'}});
  expect(await check(candidate,original,input)).toMatchObject({code:'DUPLICATE_REVIEW',matched:false});
  for(const record of [
   {verification:{...original.verification,source:{type:'app'}}},
   {verification:{...original.verification,transaction_number:'OTHERREF123'}},
   {verification:{...original.verification,amount:'99.00'}},
   {verification:{...original.verification,created_at:'2026-09-29T09:00:00Z'}},
   {verification:{...original.verification,account_number:'0999999999'}}
  ])expect((await check(candidate,record)).matched).toBe(false);
  expect((await check({...candidate,data:{...candidate.data,receipt:{...candidate.data.receipt,receiver_account:'0999999999'}}})).matched).toBe(false);
  expect((await recoverProviderDuplicate(candidate,{...input,outageAttemptAt:prior},async()=>{throw Error('Unavailable')},now)).matched).toBe(false);
 });
 it('correlates an ordinary earlier attempt but refuses unrelated or incomplete duplicate evidence',async()=>{
  const at=new Date('2026-09-29T10:09:35Z'),window={startedAt:new Date('2026-09-29T10:09:30Z'),endedAt:new Date('2026-09-29T10:10:50Z')};
  const raw={...evidence(),duplicate:true,existing_verification_id:42,verified_at:at.toISOString()};
  const record={verification:{id:42,bank:'telebirr',transaction_number:input.reference,account_number:null,success:true,exists:true,status:'completed',transaction_type:'transfer',amount:100,currency:'ETB',transaction_date:now.toISOString(),created_at:at.toISOString(),source:{type:'api'}}};
  const options={...input,priorAttempts:[window]};
  expect(await recoverProviderDuplicate(raw,options,async()=>record,now)).toMatchObject({matched:true,code:'VERIFIED_RECOVERED'});
  expect((await recoverProviderDuplicate(raw,{...options,otherAttempts:[window]},async()=>record,now)).matched).toBe(false);
  expect((await recoverProviderDuplicate(raw,{...input,priorAttempts:[{startedAt:now,endedAt:now}]},async()=>record,now)).matched).toBe(false);
  const masked={...raw,data:{...raw.data,receipt:{...raw.data.receipt,receiver_account:'***1111'}}};
  expect((await recoverProviderDuplicate(masked,options,async()=>record,now)).matched).toBe(false);
  expect((await recoverProviderDuplicate({duplicate:true,existing_verification_id:42,verified_at:at.toISOString()},options,async()=>record,now)).matched).toBe(false);
 });

});
