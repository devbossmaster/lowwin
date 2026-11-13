import {describe,it,expect} from 'vitest';
import {depositBonusPreview,type DepositBonusOffer} from '../src/lib/deposit-bonus-preview';
const policy:DepositBonusOffer={configured:true,enabled:true,percent:10,minAmount:'100.00',maxBonus:null,validityDays:7,endsAt:null,version:1};
describe('deposit bonus display follows integer-cent offer rules',()=>{
 it('does not advertise disabled or unavailable offers',()=>{expect(depositBonusPreview('100',{...policy,enabled:false}).active).toBe(false);expect(depositBonusPreview('100',{...policy,configured:false}).bonusAmount).toBe('0.00')});
 it('only qualifies at the minimum',()=>{expect(depositBonusPreview('99.99',policy).bonusAmount).toBe('0.00');expect(depositBonusPreview('100',policy)).toMatchObject({bonusAmount:'10.00',totalCredit:'110.00',qualifies:true})});
 it('floors fractional bonus cents and respects a cap',()=>{expect(depositBonusPreview('100.19',policy).bonusAmount).toBe('10.01');expect(depositBonusPreview('1000',{...policy,maxBonus:'25.00'}).bonusAmount).toBe('25.00')});
 it('supports one hundred percent without floating-point arithmetic',()=>{expect(depositBonusPreview('1099.99',{...policy,percent:100})).toMatchObject({bonusAmount:'1099.99',totalCredit:'2199.98'})});
 it('does not show an expired offer',()=>{expect(depositBonusPreview('100',{...policy,endsAt:'2026-11-13T00:00:00Z'},Date.parse('2026-11-13T00:00:00Z')).active).toBe(false)});
 it('fails closed for malformed policy and input',()=>{for(const input of ['-1','1e4','not money'])expect(depositBonusPreview(input,policy).active).toBe(false);expect(depositBonusPreview('100',{...policy,percent:101}).active).toBe(false)});
});
