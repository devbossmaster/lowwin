import {describe,expect,it} from 'vitest';
import {bidFeeNotice} from '../src/components/my-bids-copy';
describe('v4 receipt fee wording follows its evidence',()=>{
 it('reports paid only for the supported paid status',()=>{expect(bidFeeNotice('PAID',false)).toContain('submission fee was paid');expect(bidFeeNotice('PAID',true)).toContain('ተከፍሏል')});
 it('does not claim a payment for an entry with no required fee',()=>{expect(bidFeeNotice('NOT_REQUIRED',false)).toContain('No submission fee was charged');expect(bidFeeNotice('NOT_REQUIRED',false)).not.toContain('was paid');expect(bidFeeNotice('NOT_REQUIRED',true)).toContain('አልተከፈለም')});
 it('keeps missing evidence unknown instead of claiming success',()=>{expect(bidFeeNotice('UNAVAILABLE',false)).toContain('Check your payment records');expect(bidFeeNotice('UNAVAILABLE',false)).not.toContain('was paid');expect(bidFeeNotice('UNAVAILABLE',true)).not.toContain('ተከፍሏል')});
 it.each(['PAID','NOT_REQUIRED','UNAVAILABLE'] as const)('never treats the chosen number as a charge for %s',status=>{expect(bidFeeNotice(status,false)).toContain('not money charged or reserved');expect(bidFeeNotice(status,true)).toContain('የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም')});
});
