import {describe,expect,it} from 'vitest';
import {markChapaDispatch,measureChapa,timedChapaResponse} from '../src/modules/payments/chapa-timing';

describe('private checkout Server-Timing',()=>{
 it('keeps concurrent request phases separate and records failed provider work',async()=>{
  const [initialized,verified]=await Promise.all([
   timedChapaResponse(async()=>{try{await measureChapa('initialize',async()=>{await new Promise(resolve=>setTimeout(resolve,5));throw Error('synthetic timeout')})}catch{}return Response.json({status:'PENDING'})}),
   timedChapaResponse(async()=>{await measureChapa('verify',async()=>undefined);return Response.json({status:'CREDITED'})}),
  ]);
  expect(initialized.headers.get('Server-Timing')).toMatch(/^initialize;dur=\d+\.\d, total;dur=\d+\.\d$/);
  expect(verified.headers.get('Server-Timing')).toMatch(/^verify;dur=\d+\.\d, total;dur=\d+\.\d$/);
  expect(await initialized.json()).toEqual({status:'PENDING'});
 });
 it('works for a worker without a request context and propagates errors',async()=>{
  expect(markChapaDispatch()).toBeUndefined();
  expect(await measureChapa('database',async()=>42)).toBe(42);
  await expect(measureChapa('verify',async()=>{throw Error('synthetic') })).rejects.toThrow('synthetic');
 });
 it('separates preparation, dispatch, provider and durable authorization storage without identifiers',async()=>{
  const response=await timedChapaResponse(async()=>{
   await measureChapa('prepare',async()=>undefined);markChapaDispatch();markChapaDispatch();
   await measureChapa('initialize',async()=>undefined);await measureChapa('persist',async()=>undefined);
   return Response.json({status:'AUTH_NEEDED'});
  });
  const timing=response.headers.get('Server-Timing')!;
  expect(timing).toMatch(/^prepare;dur=\d+\.\d, dispatch;dur=\d+\.\d, initialize;dur=\d+\.\d, persist;dur=\d+\.\d, total;dur=\d+\.\d$/);
  expect(timing.match(/dispatch;/g)).toHaveLength(1);
 });
});
