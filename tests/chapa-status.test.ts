import {describe,expect,it} from 'vitest';
import {CHAPA_LONG_WAIT_MS,chapaLongWait,chapaPaymentPhase} from '../src/lib/chapa-status';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const pending={purpose:'TOP_UP',status:'PENDING',providerStatus:'PENDING',verificationState:'UNVERIFIED',fundsPreserved:false,receipt:null} as ChapaCheckoutView;
const state={order:pending,opening:false,restoring:false,paused:false,error:''};
describe('payment modal states follow server evidence',()=>{
 it('uses a quieter long-wait view after 90 seconds without changing or hiding authoritative states',()=>{
  const created=Date.parse('2026-10-30T10:00:00Z'),order={...pending,createdAt:new Date(created).toISOString()};
  expect(CHAPA_LONG_WAIT_MS).toBe(90000);expect(chapaLongWait(order,created+89999)).toBe(false);expect(chapaLongWait(order,created+90000)).toBe(true);
  expect(order.status).toBe('PENDING');expect(chapaLongWait({...order,status:'CREDITED'},created+90000)).toBe(false);
  for(const status of ['NEEDS_REVIEW','FAILED','CANCELLED','BLOCKED','AUTH_NEEDED'])expect(chapaLongWait({...order,status},created+90000)).toBe(false);
  expect(chapaLongWait({...order,createdAt:'invalid'},created+90000)).toBe(false);
 });
 it('keeps redirects and provider success separate from applied Lowwin credit',()=>{
  expect(chapaPaymentPhase(state)).toBe('confirming');
  expect(chapaPaymentPhase({...state,order:{...pending,providerStatus:'SUCCESS'}})).toBe('applying');
  expect(chapaPaymentPhase({...state,order:{...pending,status:'CREDITED'},error:'stale error',opening:true})).toBe('confirmed');
 });
 it('never hides a mismatch or unavailable verification behind an endless spinner',()=>{
  expect(chapaPaymentPhase({...state,order:null,error:'Connection interrupted'})).toBe('interrupted');
  expect(chapaPaymentPhase({...state,order:{...pending,status:'NEEDS_REVIEW',verificationState:'MISMATCH'}})).toBe('review');
  expect(chapaPaymentPhase({...state,order:{...pending,verificationState:'UNAVAILABLE'}})).toBe('unavailable');
  expect(chapaPaymentPhase({...state,paused:true})).toBe('pending');
  expect(chapaPaymentPhase({...state,paused:true,error:'offline',order:{...pending,verificationState:'UNAVAILABLE'}})).toBe('unavailable');
  expect(chapaPaymentPhase({...state,error:'configuration',errorCode:'CONFIGURATION_CHANGED'})).toBe('review');
  expect(chapaPaymentPhase({...state,error:'not owned',errorCode:'NOT_FOUND'})).toBe('access');
 });
 it('requires a bid receipt, preserves late-payment funds and honors provider failures',()=>{
  expect(chapaPaymentPhase({...state,order:{...pending,purpose:'BID',status:'BID_ACCEPTED'}})).not.toBe('confirmed');
  expect(chapaPaymentPhase({...state,order:{...pending,purpose:'BID',status:'NEEDS_REVIEW',fundsPreserved:true}})).toBe('preserved');
  for(const status of ['FAILED','CANCELLED','BLOCKED','INCOMPLETE'])expect(chapaPaymentPhase({...state,order:{...pending,status}})).toBe('failed');
 });
 it('pauses automatic checks after five minutes without inventing a checkout expiry or failure',()=>{
  const created=Date.parse('2026-10-30T10:00:00Z'),order={...pending,createdAt:new Date(created).toISOString(),expiresAt:new Date(created+86400000).toISOString()};
  expect(chapaPaymentPhase({...state,order,now:created+299999})).toBe('confirming');
  expect(chapaPaymentPhase({...state,order,now:created+300000})).toBe('pending');
  expect(chapaPaymentPhase({...state,order,paused:false,now:created+3600000})).toBe('pending');
  expect(order.status).toBe('PENDING');expect(order.providerStatus).toBe('PENDING');
 });
 it('does not infer payment outcome from recorded validity and accepts late authoritative success',()=>{
  const created=Date.parse('2026-10-30T10:00:00Z'),order={...pending,createdAt:new Date(created).toISOString(),expiresAt:new Date(created+60000).toISOString()};
  const expired={...state,order,now:created+60000};
  expect(chapaPaymentPhase(expired)).toBe('confirming');
  expect(chapaPaymentPhase({...expired,order:{...order,providerStatus:'SUCCESS'}})).toBe('applying');
  expect(chapaPaymentPhase({...expired,order:{...order,status:'CREDITED'}})).toBe('confirmed');
  expect(chapaPaymentPhase({...expired,order:{...order,verificationState:'MISMATCH'}})).toBe('review');
  expect(chapaPaymentPhase({...expired,order:{...order,status:'FAILED'}})).toBe('failed');
  for(const status of ['CANCELLED','INCOMPLETE','BLOCKED'])expect(chapaPaymentPhase({...expired,order:{...order,status}})).toBe('failed');
 });
 it('keeps the required provider authorization visible after automatic checks pause',()=>{
  const created=Date.parse('2026-10-31T10:00:00Z'),order={...pending,status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',createdAt:new Date(created).toISOString(),expiresAt:new Date(created+86400000).toISOString()};
  expect(chapaPaymentPhase({...state,order,paused:true,now:created+600000})).toBe('authorization');
  expect(chapaLongWait(order,created+600000)).toBe(false);
  expect(chapaPaymentPhase({...state,order:{...order,providerStatus:'SUCCESS'},paused:true,now:created+600000})).toBe('applying');
 });
});
