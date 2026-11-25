import {describe,it,expect,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {automaticNotificationKinds,deliveryNotificationKinds,internalNotificationKinds,notificationRetired,endingReminders,endingReminderCurrent,upcomingReminder,upcomingReminderCurrent,retiredPreStartReminderKinds} from '../src/modules/notifications/policy';
import {resultRecipientIds,hasResultSubscription} from '../src/modules/notifications/result-audience';

describe('finalized owner notification policy',()=>{
 it('permits committed refund notices with the automatic types and existing manual broadcast',()=>{
  expect(automaticNotificationKinds).toContain('AUCTION_FEE_REFUNDED');
  expect(automaticNotificationKinds).toHaveLength(14);
  expect(new Set(automaticNotificationKinds).size).toBe(14);
  expect(deliveryNotificationKinds).toContain('BROADCAST');
  expect(deliveryNotificationKinds).toHaveLength(13);
  for(const kind of retiredPreStartReminderKinds){
   expect(automaticNotificationKinds).toContain(kind);
   expect(deliveryNotificationKinds).not.toContain(kind);
   expect(notificationRetired(kind)).toBe(true);
  }
  for(const kind of [...deliveryNotificationKinds,...internalNotificationKinds])expect(notificationRetired(kind)).toBe(false);
 });
 it.each(['AUCTION_RESULT','AUCTION_WON','AUCTION_NO_WINNER','CONTACT_CONFIRMED','PAYMENT_VERIFIED','ANY_FUTURE_UNKNOWN',''])('fails closed for %s',kind=>{
  expect(notificationRetired(kind)).toBe(true);
 });
 it('uses mutually exclusive remaining-time windows and never sends at zero',()=>{
  const now=new Date('2026-11-14T00:00Z'),hour=3_600_000;
  for(const remaining of [-1,0,1,hour,hour+1,12*hour,12*hour+1,24*hour,24*hour+1,48*hour,48*hour+1,72*hour,72*hour+1]){
   const date=new Date(now.getTime()+remaining);
   expect(endingReminders.filter(r=>endingReminderCurrent(r.kind,date,now))).toHaveLength(remaining>0&&remaining<=72*hour?1:0);
   expect(upcomingReminderCurrent(date,new Date(0),date.toISOString(),now)).toBe(remaining<=upcomingReminder.leadMs&&remaining>upcomingReminder.leadMs-upcomingReminder.deliveryGraceMs);
  }
  expect(endingReminderCurrent('AUCTION_ENDING',new Date(NaN),now)).toBe(false);
  expect(upcomingReminderCurrent(new Date(NaN),new Date(0),now.toISOString(),now)).toBe(false);
 });
 it('selects a bounded private initiated audience and honors explicit opt-outs without rewriting preferences',async()=>{
  const query=vi.fn(async(_statement:Prisma.Sql)=>[{id:'user-1'}]),tx={$queryRaw:query} as unknown as Prisma.TransactionClient;
  const before=new Date('2026-11-14T00:00Z');
  expect(await resultRecipientIds(tx,before,'user-0')).toEqual([{id:'user-1'}]);
  const statement=query.mock.calls[0][0] as unknown as Prisma.Sql;
  expect(statement.text).toContain('LEFT JOIN "NotificationPreference"');
  expect(statement.text).toContain('COALESCE(n.telegram,true)');
  expect(statement.text).toContain('c."chatId"=u."telegramId"');
  expect(statement.text).toContain('c."startedAt"<=');
  expect(statement.text).toContain('ORDER BY u.id ASC LIMIT 250');
  expect(statement.values).toContain('user-0');
  expect(await hasResultSubscription(tx,'user-1')).toBe(true);
 });
});
