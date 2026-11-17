import {afterEach,describe,expect,it,vi} from 'vitest';
import {createChapaEventStream,chapaEventStreamHeaders} from '../src/modules/payments/chapa-event-stream';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const pending={id:'00000000-0000-4000-8000-000000000001',purpose:'TOP_UP',status:'PENDING',fundsPreserved:false,receipt:null} as ChapaCheckoutView;
const decode=(chunk:ReadableStreamReadResult<Uint8Array>)=>new TextDecoder().decode(chunk.value);
async function flush(){for(let count=0;count<8;count++)await Promise.resolve()}
function fixture(){
 const abort=new AbortController(),authorized=vi.fn().mockResolvedValue(true),read=vi.fn().mockResolvedValue(pending),cleanup=vi.fn();let notify!:()=>void;
 const subscribe=vi.fn(async(callback:()=>void)=>{notify=callback;return cleanup});
 const stream=createChapaEventStream({initial:pending,expiresAt:Date.now()+600000,signal:abort.signal,authorized,read,subscribe});
 return {abort,authorized,read,cleanup,subscribe,notify:()=>notify(),reader:stream.getReader()};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()});
describe('private committed Chapa event stream',()=>{
 it('flushes an owned snapshot and rereads after subscription to cover missed commits',async()=>{
  vi.useFakeTimers();const f=fixture();expect(decode(await f.reader.read())).toContain(': connected');expect(decode(await f.reader.read())).toContain('"status":"PENDING"');
  expect(decode(await f.reader.read())).toContain('event: checkout');expect(f.authorized).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledOnce();
  f.read.mockResolvedValue({...pending,status:'CREDITED'});f.notify();expect(decode(await f.reader.read())).toContain('"status":"CREDITED"');expect(f.authorized).toHaveBeenCalledTimes(2);await f.reader.cancel();
 });
 it('coalesces duplicate signals during an in-flight read and checks the deferred snapshot',async()=>{
  vi.useFakeTimers();const f=fixture();await f.reader.read();await f.reader.read();await f.reader.read();
  let finish!:(order:ChapaCheckoutView)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));f.notify();await flush();
  f.notify();f.notify();f.notify();f.read.mockResolvedValue({...pending,status:'CREDITED'});finish(pending);
  expect(decode(await f.reader.read())).toContain('PENDING');expect(decode(await f.reader.read())).toContain('CREDITED');expect(f.read).toHaveBeenCalledTimes(3);await f.reader.cancel();
 });
 it('does not publish any snapshot after session revocation',async()=>{
  vi.useFakeTimers();const f=fixture();await f.reader.read();await f.reader.read();await f.reader.read();
  f.authorized.mockResolvedValue(false);f.notify();expect(decode(await f.reader.read())).toContain('event: authorization');expect((await f.reader.read()).done).toBe(true);
  expect(f.read).toHaveBeenCalledOnce();expect(f.cleanup).toHaveBeenCalledOnce();
 });
 it('sends authenticated heartbeats and bounds stream lifetime for session revalidation',async()=>{
  vi.useFakeTimers();const f=fixture();await f.reader.read();await f.reader.read();await f.reader.read();
  await vi.advanceTimersByTimeAsync(15000);expect(decode(await f.reader.read())).toContain(': heartbeat');expect(f.authorized).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(40000);expect(decode(await f.reader.read())).toContain(': heartbeat');expect(decode(await f.reader.read())).toContain(': heartbeat');expect((await f.reader.read()).done).toBe(true);expect(f.cleanup).toHaveBeenCalledOnce();
 });
 it('releases subscribers and timers on disconnect even during subscription setup',async()=>{
  vi.useFakeTimers();let finish!:(stop:()=>void)=>void;const cleanup=vi.fn(),abort=new AbortController();
  const stream=createChapaEventStream({initial:pending,expiresAt:Date.now()+5000,signal:abort.signal,authorized:vi.fn().mockResolvedValue(true),read:vi.fn().mockResolvedValue(pending),subscribe:()=>new Promise(resolve=>{finish=resolve})});
  const reader=stream.getReader();await reader.read();await reader.read();abort.abort();finish(cleanup);await flush();expect(cleanup).toHaveBeenCalledOnce();expect((await reader.read()).done).toBe(true);expect(vi.getTimerCount()).toBe(0);
 });
 it('prevents caching, transformations and nginx buffering',()=>{
  expect(chapaEventStreamHeaders['Cache-Control']).toContain('private, no-store');expect(chapaEventStreamHeaders['Cache-Control']).toContain('no-transform');expect(chapaEventStreamHeaders['X-Accel-Buffering']).toBe('no');expect(chapaEventStreamHeaders.Vary).toBe('Cookie');
 });
});
