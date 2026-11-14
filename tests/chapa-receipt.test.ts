import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Outbox} from '@prisma/client';
import {chapaReceiptKind,chapaReceiptContent,queueChapaReceipt} from '../src/modules/notifications/chapa-receipt';
import {materializeAlert} from '../src/modules/notifications/service';
import {dispatchOne} from '../src/modules/notifications/dispatch';
import {notificationDispatchFixture} from './notification-dispatch-fixture';
afterEach(()=>vi.unstubAllEnvs());
describe('retired Chapa bot receipts and admin alerts',()=>{
 it('does not enqueue customer or configured merchant alerts after verified fulfillment',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');const upsert=vi.fn(),order={id:'8ae9f066-9f2c-4666-a61d-17a50cb07201',userId:'owner',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',creditJournalId:'journal',purpose:'TOP_UP',currency:'ETB',amountCents:1000n};
  expect(await queueChapaReceipt({outbox:{upsert}} as never,order as never)).toBeNull();expect(upsert).not.toHaveBeenCalled();expect(order.creditJournalId).toBe('journal');expect(order.status).toBe('CREDITED');
 });
 it.each([{}, {merchantRecipientTelegramId:'900000002'}])('skips already queued receipts without fetching customer data %j',async extra=>{
  const findUnique=vi.fn(),upsert=vi.fn(),tx={chapaCheckout:{findUnique},notificationInbox:{upsert}};
  const row={kind:chapaReceiptKind,key:'old-receipt',payload:{checkoutId:'checkout',recipientUserId:'owner',...extra}};
  expect(await chapaReceiptContent(tx as never,row)).toBeNull();await materializeAlert(tx as never,row);expect(findUnique).not.toHaveBeenCalled();expect(upsert).not.toHaveBeenCalled();
 });
 it('marks legacy queued receipt skipped without a Telegram request or ledger mutation',async()=>{
  const job={id:'receipt-outbox',kind:chapaReceiptKind,key:'old-receipt',payload:{checkoutId:'checkout',recipientUserId:'owner'},state:'PENDING',attempts:0,nextAttemptAt:new Date(0),createdAt:new Date(),leaseToken:null,leaseUntil:null,sentAt:null,lastError:null,claimedAt:null,settlementId:null,testRunId:null} as Outbox;
  const f=notificationDispatchFixture([job]),sendMessage=vi.fn(),sendPhoto=vi.fn();
  expect(await dispatchOne(f.client,{api:{sendMessage,sendPhoto}} as never,{kind:chapaReceiptKind})).toBe(true);
  expect(job).toMatchObject({state:'SKIPPED',lastError:'NOTIFICATION_RETIRED'});expect(sendMessage).not.toHaveBeenCalled();expect(sendPhoto).not.toHaveBeenCalled();
  expect(await dispatchOne(f.client,{api:{sendMessage,sendPhoto}} as never,{kind:chapaReceiptKind})).toBe(false);
 });
});
