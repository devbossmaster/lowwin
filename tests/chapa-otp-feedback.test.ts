import {describe,expect,it} from 'vitest';
import {chapaRetainOtpError,type ChapaCheckoutView} from '../src/lib/chapa-client';

const order={id:'0f55aaab-2222-4444-8888-123456789012',apiVersion:'v2',flowVersion:4,chargeType:'INLINE',purpose:'TOP_UP',status:'AUTH_NEEDED',providerStatus:null,verificationState:'UNVERIFIED',authType:'OTP',authorizationReference:'CH-owned-challenge',fundsPreserved:false,receipt:null} as ChapaCheckoutView;
describe('owned rejected OTP feedback',()=>{
 it('survives delayed and unchanged status snapshots for the same pending challenge',()=>{
  expect(chapaRetainOtpError(order,{...order},'INVALID_OTP')).toBe(true);
  expect(chapaRetainOtpError(order,{...order,status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED'},'INVALID_OTP')).toBe(true);
 });
 it('does not transfer a rejection to another checkout, challenge or authorization method',()=>{
  for(const next of [{...order,id:'different-checkout'},{...order,authorizationReference:'CH-new-challenge'},{...order,authorizationReference:null},{...order,authType:'USSD' as const}])expect(chapaRetainOtpError(order,next,'INVALID_OTP')).toBe(false);
  expect(chapaRetainOtpError(null,order,'INVALID_OTP')).toBe(false);
 });
 it('clears on explicit resubmission and does not pin connection or unrecognized errors',()=>{
  for(const code of [null,'UNAVAILABLE','PROVIDER_UNAVAILABLE','ARBITRARY_MESSAGE'])expect(chapaRetainOtpError(order,order,code)).toBe(false);
 });
 it('yields to verified progress, terminal outcomes, review and completion reconciliation',()=>{
  for(const next of [{...order,status:'CREDITED',providerStatus:'SUCCESS'},{...order,status:'PENDING',providerStatus:'SUCCESS'},{...order,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED'},{...order,status:'NEEDS_REVIEW',verificationState:'MISMATCH'},{...order,completionSignalPending:true},{...order,fundsPreserved:true}])expect(chapaRetainOtpError(order,next,'INVALID_OTP')).toBe(false);
 });
});
