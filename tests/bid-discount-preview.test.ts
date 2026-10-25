import {describe,expect,it} from 'vitest';
import {usableBidDiscount} from '../src/lib/bid-discount-preview';

const quote={eligible:true,feeVersion:2,grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',serverNow:'2026-10-26T10:00:00Z',coupon:{id:'owned-reward',percent:10,expiresAt:'2026-10-26T10:01:00Z'}};
describe('earned fee discount preview',()=>{
 it('displays the server quote against the current fee and version',()=>{expect(usableBidDiscount(quote,2,'10.00',1000,2000)).toBe(quote)});
 it('does not apply a quote from another fee revision or fee amount',()=>{expect(usableBidDiscount(quote,3,'10',1000,2000)).toBeNull();expect(usableBidDiscount(quote,2,'12',1000,2000)).toBeNull()});
 it('expires a cached quote using server time and receipt age',()=>{expect(usableBidDiscount(quote,2,'10',1000,61000)).toBeNull();expect(usableBidDiscount(quote,2,'10',1000,60999)).toBe(quote)});
 it('never fabricates a price from an absent, ineligible or inconsistent quote',()=>{expect(usableBidDiscount(null,2,'10',1000)).toBeNull();expect(usableBidDiscount({...quote,eligible:false},2,'10',1000,2000)).toBeNull();expect(usableBidDiscount({...quote,netFeePoints:'8'},2,'10',1000,2000)).toBeNull();expect(usableBidDiscount({...quote,coupon:null},2,'10',1000,2000)).toBeNull()});
});
