import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Outbox} from '@prisma/client';
import {dispatchBatch} from '../src/modules/notifications/dispatch';
import {notificationDispatchFixture} from './notification-dispatch-fixture';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()});
describe('immutable broadcast preparation across worker batches',()=>{
 it('models a 60-second window with one content read and a fresh final gate per actual send',async()=>{
  vi.stubEnv('MINI_APP_URL','https://lowwin.test');vi.stubEnv('TELEGRAM_BOT_TOKEN','123456789:fixture-only');
  const now=new Date(),jobs:Outbox[]=[],f=notificationDispatchFixture(jobs,now);
  const read=vi.fn(async()=>({status:'LIVE',endsAt:new Date(now.getTime()+86400000),product:{visible:true}}));
  Object.assign(f.tx,{auction:{findUnique:read}});
  const send=vi.fn(async()=>({message_id:1})),bot={api:{sendMessage:send,sendPhoto:send}};
  let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
  const make=(index:number)=>({id:'cache-'+index,key:'broadcast:cache:user:'+index,kind:'BROADCAST',payload:{auctionId:'auction',rootKey:'broadcast:cache',recipientUserId:'player-'+index,body:'Reviewed public promotion',href:'/auctions/42'},createdAt:now,nextAttemptAt:new Date(0),state:'PENDING',attempts:0,sentAt:null,lastError:null,leaseToken:null,leaseUntil:null,claimedAt:null,settlementId:null,testRunId:null}) as Outbox;
  for(let i=0;i<720;i++){elapsed=i*(60_000/720);jobs.push(make(i));expect(await dispatchBatch(f.client,bot as never,{limit:1,concurrency:1})).toBe(1)}
  expect(send).toHaveBeenCalledTimes(720);expect(read).toHaveBeenCalledTimes(1);
  const gates=()=>f.tx.$queryRaw.mock.calls.filter(([sql])=>('strings'in sql?sql.strings:sql).join('').includes('ELSE NULL END AS reason')).length;
  expect(gates()).toBe(720);
  elapsed=60_001;jobs.push(make(720));await dispatchBatch(f.client,bot as never,{limit:1,concurrency:1});
  expect(read).toHaveBeenCalledTimes(2);expect(gates()).toBe(721);
 },20000);
});
