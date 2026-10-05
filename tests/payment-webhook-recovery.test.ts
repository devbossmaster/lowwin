import {describe,expect,it} from 'vitest';
import {imageWebhookWait,RECOVERY_WINDOW_MS,retryDetails,WEBHOOK_RECHECK_MS,WEBHOOK_REVIEW_AFTER_MS} from '../src/modules/payments/retry';

describe('queued receipt image webhook recovery',()=>{
 const createdAt=new Date('2026-10-05T08:00:00Z');
 const expiresAt=new Date('2026-10-05T08:30:00Z');
 it('keeps the request recoverable through the provider webhook retry period',()=>{
  const now=new Date(createdAt.getTime()+WEBHOOK_REVIEW_AFTER_MS-1),wait=imageWebhookWait(createdAt,expiresAt,now);
  expect(wait).toMatchObject({delayed:false,expired:false});
  expect(wait.nextCheckAt.getTime()).toBe(now.getTime()+WEBHOOK_RECHECK_MS);
 });
 it('moves a delayed result to review without closing webhook recovery',()=>{
  expect(imageWebhookWait(createdAt,expiresAt,new Date(createdAt.getTime()+WEBHOOK_REVIEW_AFTER_MS))).toMatchObject({delayed:true,expired:false});
  expect(retryDetails({status:'NEEDS_REVIEW',caseState:'OPEN',reasonCode:'WEBHOOK_DELAYED',attempts:1,expiresAt,nextAttemptAt:createdAt,leaseUntil:null},createdAt)).toMatchObject({canRetry:false,retryBlocked:'WEBHOOK_DELAYED'});
 });
 it('ends automatic recovery only after the frozen deposit recovery window',()=>{
  const boundary=new Date(expiresAt.getTime()+RECOVERY_WINDOW_MS);
  expect(imageWebhookWait(createdAt,expiresAt,boundary).expired).toBe(false);
  expect(imageWebhookWait(createdAt,expiresAt,new Date(boundary.getTime()+1)).expired).toBe(true);
 });
});
