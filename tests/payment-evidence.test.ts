import {describe,it,expect} from 'vitest';
import {assess,type VerificationInput} from '../src/modules/payments/provider';
const now=new Date('2026-09-29T10:10:00Z');
const input:VerificationInput={bank:'telebirr',reference:'DEL889NG4S',account:'0911111111',expectedCents:10000n,createdAt:new Date('2026-09-29T10:00:00Z'),expiresAt:new Date('2026-09-29T10:30:00Z')};
function evidence(){return {success:true,exists:true,duplicate:false,data:{bank:'telebirr',transaction_number:input.reference,verification_method:'official',receipt:{status:'completed',transaction_type:'transfer',amount:'100.00',currency:'ETB',transaction_date:now.toISOString(),receiver_account:input.account}}}}
describe('official payment evidence',()=>{
 it('accepts only the complete exact evidence',()=>{expect(assess(evidence(),input,now).matched).toBe(true)});
 it('routes provider duplicates to review even with matching official evidence',()=>{expect(assess({...evidence(),duplicate:true},input,now)).toMatchObject({matched:false,code:'DUPLICATE_REVIEW'})});
 it('fails closed when duplicate or transfer type is unknown',()=>{
  const raw:Record<string,unknown>=evidence();delete raw.duplicate;expect(assess(raw,input,now).matched).toBe(false);
  const other=evidence();delete (other.data.receipt as Partial<typeof other.data.receipt>).transaction_type;expect(assess(other,input,now).matched).toBe(false);
 });
});
