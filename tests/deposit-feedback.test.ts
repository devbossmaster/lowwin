import {it,expect} from 'vitest';
import {depositFeedback} from '../src/components/deposit-feedback';
import {walletAm} from '../src/components/wallet-copy';
it('announces credit only for a committed credit and translates every outcome',()=>{
 for(const status of ['CREDITED','NEEDS_REVIEW','PROVIDER_OUTAGE','DUPLICATE_CONFLICT','REJECTED','VERIFYING','PENDING']){
  const r={status,points:'30.27'},en=depositFeedback(r,s=>s),am=depositFeedback(r,s=>walletAm[s]??s);
  expect(en.kind==='success').toBe(status==='CREDITED');expect(am.message).not.toBe(en.message);
 }
 expect(depositFeedback({status:'CREDITED',points:'30.27',reused:true},s=>s).message).toContain('No second credit');
 expect(depositFeedback({status:'NEEDS_REVIEW',points:'0',reused:true},s=>s).message).toContain('check again');
 expect(depositFeedback({status:'REJECTED',points:'0',reason:'ADMIN_REJECTED'},s=>s).message).toContain('admin rejected');
});

it('gives translated corrections for rejected IDs without directing them to admin review',()=>{
 for(const reason of ['NOT_FOUND','INVALID_RECEIPT','REFERENCE_MISMATCH','RECEIVER_MISMATCH','AMOUNT_MISMATCH','DATE_MISMATCH','DUPLICATE_CONFLICT']){
  const receipt={status:'REJECTED',points:'0',reason},en=depositFeedback(receipt,s=>s),am=depositFeedback(receipt,s=>walletAm[s]??s);
  expect(en.kind).toBe('error');expect(en.message).not.toMatch(/admin review|contact support/i);expect(am.message).not.toBe(en.message);
 }
});
