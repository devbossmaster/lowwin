import {describe,expect,it,vi} from 'vitest';
import {runNotificationLanes} from '../src/modules/notifications/worker-lanes';
import {notificationSettings} from '../src/modules/notifications/settings';

describe('independent bounded notification worker lanes',()=>{
 it('keeps personal delivery running while verification, scheduling and bulk HTTP are slow',async()=>{
  const stop=new AbortController();let release!:()=>void;const slow=new Promise<void>(resolve=>release=resolve),personal=vi.fn(async()=>1),bulk=vi.fn(async()=>{await slow;return 1});
  const running=runNotificationLanes({schedule:()=>slow,expand:async()=>{await slow;return 0},verify:async()=>{await slow;return false},send:priority=>priority==='high'?personal():bulk()},notificationSettings({NOTIFICATION_SEND_CONCURRENCY:'3'}),stop.signal);
  await vi.waitFor(()=>expect(personal.mock.calls.length).toBeGreaterThanOrEqual(2));expect(bulk).toHaveBeenCalledTimes(2);stop.abort();release();await running;
 });
 it('stops new claims on shutdown and bounds already in-flight sends by concurrency',async()=>{
  const stop=new AbortController();let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve),send=vi.fn(async()=>{await pending;return 1});
  const running=runNotificationLanes({schedule:async()=>false,expand:async()=>0,verify:async()=>false,send},notificationSettings({NOTIFICATION_SEND_CONCURRENCY:'4'}),stop.signal);
  expect(send).toHaveBeenCalledTimes(4);stop.abort();release();await running;expect(send).toHaveBeenCalledTimes(4);
 });
});
