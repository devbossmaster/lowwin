import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Outbox} from '@prisma/client';
import {notificationDispatchFixture} from './notification-dispatch-fixture';
import {highPriorityKinds} from '../src/modules/notifications/leases';

const content=vi.hoisted(()=>vi.fn());
const photo=vi.hoisted(()=>vi.fn(async(_db:unknown,_path:string)=> 'https://lowwin.test/product.webp'));
vi.mock('../src/modules/notifications/service',()=>({notificationContent:content,materializeAlert:vi.fn(),notificationPhoto:vi.fn(async()=>null),telegramCampaignText:(_kind:string,title:string,body:string)=>`${title}\n${body}`}));
vi.mock('../src/modules/notifications/auction-photo',()=>({auctionPhoto:photo}));
import {dispatchBatch} from '../src/modules/notifications/dispatch';

const job=(id:string,kind:string,userId='player'):Outbox=>({id,key:`fixture:${id}`,kind,payload:{auctionId:'auction',recipientUserId:userId},createdAt:new Date(),nextAttemptAt:new Date(0),state:'PENDING',attempts:0,sentAt:null,lastError:null,leaseToken:null,leaseUntil:null,claimedAt:null,settlementId:null,testRunId:null});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('MINI_APP_URL','https://lowwin.test');vi.stubEnv('TELEGRAM_BOT_TOKEN','123456789:fixture-only')});
afterEach(()=>vi.unstubAllEnvs());

describe('private notification speed and recipient isolation',()=>{
 it('reserves personal capacity for actual deposit, purchase and winner messages only',()=>{
  expect(highPriorityKinds).toEqual(['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS']);
  expect(highPriorityKinds).not.toContain('BROADCAST');expect(highPriorityKinds).not.toContain('CONTACT_CONFIRMED');
 });
 it('does not share one purchaser receipt or product photo with another recipient',async()=>{
  const jobs:Outbox[]=[],f=notificationDispatchFixture(jobs),send=vi.fn(async(..._args:unknown[])=>({message_id:1}));
  content.mockImplementation(async(_db,row:Outbox)=>({userId:(row.payload as {recipientUserId:string}).recipientUserId,kind:row.kind,title:'Receipt',body:'Private receipt',telegramCaption:`{name}: ${(row.payload as {recipientUserId:string}).recipientUserId}`,href:'/my-bids',imagePath:`/products/${(row.payload as {recipientUserId:string}).recipientUserId}.webp`}));
  jobs.push(job('one','BID_ACCEPTED','one'));await dispatchBatch(f.client,{api:{sendPhoto:send,sendMessage:send}} as never,{limit:1});
  jobs.push(job('two','BID_ACCEPTED','two'));await dispatchBatch(f.client,{api:{sendPhoto:send,sendMessage:send}} as never,{limit:1});
  expect(content).toHaveBeenCalledTimes(2);expect(photo.mock.calls.map(args=>args[1])).toEqual(['/products/one.webp','/products/two.webp']);
  expect(send.mock.calls[0]?.[2]).toMatchObject({caption:'Player name: one',reply_markup:{inline_keyboard:[[{text:'ጨረታዎቼን ልይ',web_app:{url:'https://lowwin.test/my-bids'}}]]}});
  expect(send.mock.calls[1]?.[2]).toMatchObject({caption:'Player name: two'});
 });
 it('rejects a non-private destination for a private winner message before transport',async()=>{
  const row=job('winner','WINNER_CONGRATULATIONS'),f=notificationDispatchFixture([row]),send=vi.fn();
  f.tx.botChat.findUnique.mockResolvedValue({telegramId:'900000001',chatId:'-100123456',blocked:false});
  content.mockResolvedValue({userId:'player',kind:row.kind,title:'Winner',body:'Private winner',href:'/winning-bids',imagePath:'/product.webp'});
  await dispatchBatch(f.client,{api:{sendPhoto:send,sendMessage:send}} as never,{limit:1});
  expect(send).not.toHaveBeenCalled();expect(row).toMatchObject({state:'SKIPPED',lastError:'PRIVATE_CHAT_REQUIRED'});
 });
 it('sends the verified deposit receipt without media preparation or media-cache database work',async()=>{
  const row=job('deposit','DEPOSIT_CREDITED'),f=notificationDispatchFixture([row]),send=vi.fn(async()=>({message_id:2}));
  content.mockResolvedValue({userId:'player',kind:row.kind,title:'Deposit',body:'Credited',href:'/wallet'});
  await dispatchBatch(f.client,{api:{sendMessage:send,sendPhoto:vi.fn()}} as never,{limit:1});
  expect(row.state).toBe('SENT');expect(send).toHaveBeenCalledTimes(1);expect(photo).not.toHaveBeenCalled();expect(f.tx.telegramMediaCache.findUnique).not.toHaveBeenCalled();
  const statements=f.tx.$queryRaw.mock.calls.map(([query])=>('strings'in query?query.strings:query).join(''));
  expect(statements.some(sql=>sql.includes('TelegramMediaCache'))).toBe(false);
  expect(statements.filter(sql=>sql.includes('ELSE NULL END AS reason'))).toHaveLength(1);
 });
});
