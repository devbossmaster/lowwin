import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const broker=vi.hoisted(()=>({listeners:new Map<string,((raw:string)=>void)[]>(),clients:[] as Array<{isOpen:boolean;isReady:boolean;on:ReturnType<typeof vi.fn>;connect:ReturnType<typeof vi.fn>;destroy:ReturnType<typeof vi.fn>;subscribe:ReturnType<typeof vi.fn>;publish:ReturnType<typeof vi.fn>}>,hold:null as Promise<void>|null,publishHold:null as Promise<number>|null,fail:false}));
vi.mock('redis',()=>({createClient:()=>{
 const client={isOpen:false,isReady:false,on:vi.fn(),withCommandOptions:vi.fn(()=>client),
  connect:vi.fn(async()=>{if(broker.fail)throw Error('private Redis URL');client.isOpen=true;client.isReady=true;return client}),
  destroy:vi.fn(()=>{client.isOpen=false;client.isReady=false}),
  subscribe:vi.fn(async(channel:string,notify:(raw:string)=>void)=>{if(broker.hold)await broker.hold;broker.listeners.set(channel,[...broker.listeners.get(channel)??[],raw=>{if(client.isReady)notify(raw)}])}),
  publish:vi.fn(async(channel:string,raw:string)=>{if(broker.publishHold)return broker.publishHold;if(broker.fail)throw Error('private Redis URL');for(const notify of broker.listeners.get(channel)??[])notify(raw);return 1})};
 broker.clients.push(client);return client;
}}));
import {chapaCommittedChannel,publishChapaCommitted,subscribeChapaCommitted} from '../src/modules/payments/chapa-committed';

const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
beforeEach(()=>{
 delete (globalThis as {lowwinChapaCommitted?:unknown}).lowwinChapaCommitted;
 broker.listeners.clear();broker.clients.length=0;broker.hold=null;broker.publishHold=null;broker.fail=false;
 vi.stubEnv('APP_ENV','production');vi.stubEnv('DATABASE_URL','postgresql://web-role:database-secret@db:5432/lowwin');vi.stubEnv('REDIS_URL','redis://default:redis-secret@redis:6379');vi.stubEnv('CHAPA_EVENTS_NAMESPACE','');vi.stubEnv('REDIS_CACHE_NAMESPACE','lowwin');
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();delete (globalThis as {lowwinChapaCommitted?:unknown}).lowwinChapaCommitted});
describe('private cross-process committed payment hints',()=>{
 it('publishes only an opaque hint through independent publisher/subscriber sockets',async()=>{
  const first=vi.fn(),second=vi.fn(),cleanup=await subscribeChapaCommitted(id,first),cleanupOther=await subscribeChapaCommitted(other,second);
  await publishChapaCommitted(id);expect(first).toHaveBeenCalledOnce();expect(second).not.toHaveBeenCalled();expect(broker.clients).toHaveLength(2);
  expect(broker.clients[0].subscribe).toHaveBeenCalledOnce();expect(broker.clients[1].publish).toHaveBeenCalledWith(chapaCommittedChannel(),JSON.stringify({v:1,id}));
  expect(chapaCommittedChannel()).toMatch(/^lowwin:payments:committed:v1:[a-f0-9]{24}$/);expect(chapaCommittedChannel()).not.toContain('public');
  cleanup();cleanupOther();await publishChapaCommitted(id);expect(first).toHaveBeenCalledOnce();
 });
 it('ignores malformed, unknown, oversized or financial broker payloads',async()=>{
  const listener=vi.fn(),cleanup=await subscribeChapaCommitted(id,listener),[notify]=broker.listeners.get(chapaCommittedChannel())!;
  for(const raw of ['invalid',JSON.stringify({v:1,id,status:'CREDITED'}),JSON.stringify({v:2,id}),JSON.stringify({v:1,id:other}),'x'.repeat(1000)])notify(raw);
  expect(listener).not.toHaveBeenCalled();notify(JSON.stringify({v:1,id}));expect(listener).toHaveBeenCalledOnce();cleanup();
 });
 it('awaits shared subscription setup for concurrent connections',async()=>{
  let finish!:()=>void;broker.hold=new Promise(resolve=>{finish=resolve});let ready=0;
  const first=subscribeChapaCommitted(id,vi.fn()).then(stop=>{ready++;return stop}),second=subscribeChapaCommitted(other,vi.fn()).then(stop=>{ready++;return stop});
  for(let count=0;count<8;count++)await Promise.resolve();expect(ready).toBe(0);expect(broker.clients[0].subscribe).toHaveBeenCalledOnce();
  finish();const cleanups=await Promise.all([first,second]);expect(ready).toBe(2);expect(broker.clients[0].subscribe).toHaveBeenCalledOnce();cleanups.forEach(stop=>stop());
 });
 it('never notifies locally or rejects a committed caller when Redis is unavailable',async()=>{
  const listener=vi.fn(),cleanup=await subscribeChapaCommitted(id,listener);broker.fail=true;
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});await expect(publishChapaCommitted(id)).resolves.toBeUndefined();expect(listener).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();cleanup();
 });
 it('bounds a stalled Pub/Sub acknowledgement even though redis command timeouts do not cover it',async()=>{
  vi.useFakeTimers();broker.hold=new Promise(()=>{});const listener=vi.fn();let cleanup:(()=>void)|undefined;
  const pending=subscribeChapaCommitted(id,listener).then(stop=>{cleanup=stop});await vi.advanceTimersByTimeAsync(499);expect(cleanup).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);await pending;expect(cleanup).toBeTypeOf('function');expect(broker.clients[0].destroy).toHaveBeenCalledOnce();cleanup!();
 });
 it('replaces a failed subscriber socket without accumulating Redis listener callbacks',async()=>{
  vi.useFakeTimers();const listener=vi.fn(),stop=await subscribeChapaCommitted(id,listener),original=broker.clients[0];
  const onError=original.on.mock.calls.find(call=>call[0]==='error')![1] as ()=>void;onError();expect(original.destroy).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);const otherStop=await subscribeChapaCommitted(other,vi.fn());expect(broker.clients).toHaveLength(2);expect(broker.clients[1]).not.toBe(original);
  await publishChapaCommitted(id);expect(listener).toHaveBeenCalledOnce();expect(original.subscribe).toHaveBeenCalledOnce();stop();otherStop();
 });
 it('does not destroy a replacement publisher when an older publication rejects',async()=>{
  vi.useFakeTimers();let rejectOld!:(error:Error)=>void;broker.publishHold=new Promise((_resolve,reject)=>{rejectOld=reject});
  const old=publishChapaCommitted(id);await vi.advanceTimersByTimeAsync(0);expect(broker.clients[0].publish).toHaveBeenCalledOnce();
  broker.publishHold=null;vi.stubEnv('CHAPA_EVENTS_NAMESPACE','replacement-test-namespace');await publishChapaCommitted(id);expect(broker.clients).toHaveLength(2);
  const replacement=broker.clients[1];expect(replacement.isReady).toBe(true);rejectOld(Error('Old unavailable socket'));await old;
  expect(replacement.destroy).not.toHaveBeenCalled();expect(replacement.isReady).toBe(true);await publishChapaCommitted(id);expect(replacement.publish).toHaveBeenCalledTimes(2);
 });
 it('supports separate database roles and an explicit common pooler namespace',()=>{
  const first=chapaCommittedChannel();vi.stubEnv('DATABASE_URL','postgresql://worker-role:different-secret@db:5432/lowwin');expect(chapaCommittedChannel()).toBe(first);
  vi.stubEnv('CHAPA_EVENTS_NAMESPACE','lowwin-production');const common=chapaCommittedChannel();vi.stubEnv('DATABASE_URL','postgresql://worker@different-pooler:6432/lowwin');expect(chapaCommittedChannel()).toBe(common);
  vi.stubEnv('APP_ENV','staging');expect(chapaCommittedChannel()).not.toBe(common);
 });
 it('does no broker work with disabled or invalid configuration',async()=>{
  vi.stubEnv('REDIS_URL','');const stop=await subscribeChapaCommitted(id,vi.fn());await publishChapaCommitted(id);stop();expect(broker.clients).toHaveLength(0);
  vi.stubEnv('REDIS_URL','redis://redis:6379');await publishChapaCommitted(id);await publishChapaCommitted('not-a-payment');expect(broker.clients).toHaveLength(0);
 });
});
