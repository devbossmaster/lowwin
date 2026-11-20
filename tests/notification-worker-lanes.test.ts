import {describe,expect,it,vi} from 'vitest';
import {runNotificationLanes} from '../src/modules/notifications/worker-lanes';
import {notificationSettings} from '../src/modules/notifications/settings';

describe('independent bounded notification worker lanes',()=>{
 it('keeps personal delivery running while verification, scheduling and bulk HTTP are slow',async()=>{
  const stop=new AbortController();let release!:()=>void;const slow=new Promise<void>(resolve=>release=resolve),personal=vi.fn(async()=>1),bulk=vi.fn(async()=>{await slow;return 1});
  const running=runNotificationLanes({schedule:()=>slow,cleanupContacts:async()=>{},expand:async()=>{await slow;return 0},verify:async()=>{await slow;return false},send:priority=>priority==='high'?personal():bulk()},notificationSettings({NOTIFICATION_SEND_CONCURRENCY:'3'}),stop.signal);
  await vi.waitFor(()=>expect(personal.mock.calls.length).toBeGreaterThanOrEqual(2));expect(bulk).toHaveBeenCalledTimes(2);stop.abort();release();await running;
 });
 it('stops new claims on shutdown and bounds already in-flight sends by concurrency',async()=>{
  const stop=new AbortController();let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve),send=vi.fn(async()=>{await pending;return 1});
  const running=runNotificationLanes({schedule:async()=>false,cleanupContacts:async()=>{},expand:async()=>0,verify:async()=>false,send},notificationSettings({NOTIFICATION_SEND_CONCURRENCY:'4'}),stop.signal);
  expect(send).toHaveBeenCalledTimes(4);stop.abort();release();await running;expect(send).toHaveBeenCalledTimes(4);
 });
 it('checks reminders again after five seconds while contact cleanup is still pending',async()=>{
  const stop=new AbortController();
  let release!:()=>void;
  const cleanup=new Promise<void>(resolve=>release=resolve);
  const schedule=vi.fn(async()=>0),cleanupContacts=vi.fn(()=>cleanup);
  const running=runNotificationLanes({schedule,cleanupContacts,expand:async()=>0,verify:async()=>false,send:async()=>0},notificationSettings({}),stop.signal);
  try{
   expect(schedule).toHaveBeenCalledTimes(1);
   await vi.waitFor(()=>expect(schedule).toHaveBeenCalledTimes(2),{timeout:6500,interval:50});
   expect(cleanupContacts).toHaveBeenCalledTimes(1);
  }finally{stop.abort();release();await running}
 },8000);
});
