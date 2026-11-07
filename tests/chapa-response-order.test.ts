import {expect,it} from 'vitest';
import {acceptChapaSnapshot,type ChapaCheckoutView} from '../src/lib/chapa-client';
const pending={id:'one',purpose:'TOP_UP',status:'AUTH_NEEDED',fundsPreserved:false,receipt:null,providerStatus:'AUTH_NEEDED'} as ChapaCheckoutView;
it('does not restore OTP/pending from a delayed poll after confirmed credit',()=>{const paid={...pending,status:'CREDITED',providerStatus:'SUCCESS'};expect(acceptChapaSnapshot(paid,pending)).toBe(false);expect(acceptChapaSnapshot(pending,paid)).toBe(true)});
it('does not regress a verified provider success awaiting local fulfillment',()=>{expect(acceptChapaSnapshot({...pending,providerStatus:'SUCCESS'},pending)).toBe(false)});
it('keeps the newer server revision and permits late verified success after failure',()=>{const newer={...pending,status:'FAILED',updatedAt:'2026-11-07T10:00:05Z'};expect(acceptChapaSnapshot(newer,{...pending,updatedAt:'2026-11-07T10:00:01Z'})).toBe(false);expect(acceptChapaSnapshot(newer,{...pending,status:'CREDITED',providerStatus:'SUCCESS',updatedAt:'2026-11-07T10:00:06Z'})).toBe(true)});
