import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {InputFile} from 'grammy';
import type {Update, UserFromGetMe} from 'grammy/types';
import {createBot} from '../src/modules/bot/bot';
import {WELCOME_CAPTION,CONTACT_REQUEST_MESSAGE,CONTACT_REPLY_KEYBOARD} from '../src/modules/bot/onboarding-copy';
import {TEST_TOKEN} from './helpers';
const f=vi.hoisted(()=>({checkout:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{chapaCheckout:{findFirst:f.checkout}}}));

describe('private Telegram welcome',()=>{
 beforeAll(()=>{for(const [key,value] of Object.entries({DATABASE_URL:'postgresql://lowin_test@127.0.0.1:55439/welcome_test',DIRECT_URL:'postgresql://lowin_test@127.0.0.1:55439/welcome_test',APP_ENV:'local',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two'}))vi.stubEnv(key,value)});
 afterAll(()=>vi.unstubAllEnvs());
 beforeEach(()=>{vi.clearAllMocks();f.checkout.mockResolvedValue(null)});
 async function send(change:Record<string,unknown>={},verified=false){
  const bot=createBot({contactVerified:async()=>verified}),sent:Array<{method:string;payload:Record<string,unknown>}>=[];
  bot.botInfo={id:123456789,is_bot:true,first_name:'Fixture',username:'lowin_fixture_bot'} as UserFromGetMe;
  bot.api.config.use(async(_prev,method,payload)=>{sent.push({method,payload:payload as unknown as Record<string,unknown>});return {ok:true,result:{message_id:1}} as never});
  await bot.handleUpdate({update_id:1,message:{message_id:1,date:1,chat:{id:7,type:'private'},from:{id:7,is_bot:false,first_name:'Fixture'},text:'/start',entities:[{type:'bot_command',offset:0,length:6}],...change}} as Update);
  return sent;
 }
 it('uploads the current welcome banner with the exact Amharic caption and inline Mini App button',async()=>{
  const sent=await send({},true);expect(sent).toHaveLength(2);expect(sent[0].method).toBe('sendMessage');expect(sent[0].payload.reply_markup).toEqual({remove_keyboard:true});expect(sent[1].method).toBe('sendPhoto');
  expect(sent[1].payload.photo).toBeInstanceOf(InputFile);expect((sent[1].payload.photo as InputFile).filename).toBe('lowwin-welcome.jpg');
  expect(sent[1].payload.caption).toBe(WELCOME_CAPTION);
  expect(sent[1].payload.caption).toContain('📢 ቻናላችን፦ @lowwinet');
  expect(sent[1].payload.caption).toContain('👥 ግሩፓችን፦ @LowWinChat');
  expect(sent[1].payload.reply_markup).toEqual({inline_keyboard:[[{text:'🎯 ጨረታ ይጀምሩ',web_app:{url:'http://localhost:3000'}}]]});
 });
 it('shows new users the private bot contact button before the Mini App launch',async()=>{
  const sent=await send();expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendPhoto');
  expect(sent[0].payload.caption).toBe(CONTACT_REQUEST_MESSAGE);expect(sent[0].payload.photo).toBeInstanceOf(InputFile);
  expect(sent[0].payload.reply_markup).toEqual(CONTACT_REPLY_KEYBOARD);
 });
 it('returns the same opaque payment to the authenticated Mini App without reporting success',async()=>{
  const id='0f55aaab-2222-4444-8888-123456789012';
  const sent=await send({text:`/start chapa_${id}`},true);
  expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendMessage');
  expect(sent[0].payload.text).toBe('Open Lowwin to check your payment. This link does not confirm payment success.');
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'Check payment',web_app:{url:`http://localhost:3000/payments/chapa/return?checkout=${id}`}}]]});
  expect(f.checkout).toHaveBeenCalledWith({where:{id,user:{telegramId:'7'},phoneBotId:TEST_TOKEN.split(':')[0]},select:{purpose:true,status:true,creditJournalId:true,bidId:true,amountCents:true,currency:true,mode:true}});
 });
 it('confirms a credited owned top-up and reopens its owned context without verifying or modifying payment',async()=>{
  f.checkout.mockResolvedValue({purpose:'TOP_UP',status:'CREDITED',creditJournalId:'verified-receipt',bidId:null,amountCents:10000n,currency:'ETB',mode:'live'});
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012'},true);
  expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendMessage');expect(sent[0].payload.text).toBe('100.00 ETB credited to your wallet.');
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'Open Lowwin',web_app:{url:'http://localhost:3000/payments/chapa/return?checkout=0f55aaab-2222-4444-8888-123456789012'}}]]});
 });
 it('confirms an owned accepted bid only from its committed receipt and bid, and reopens its owned context',async()=>{
  f.checkout.mockResolvedValue({purpose:'BID',status:'BID_ACCEPTED',creditJournalId:'verified-receipt',bidId:'accepted-bid',amountCents:1000n,currency:'ETB',mode:'live'});
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012'},true);
  expect(sent[0].payload.text).toBe('10.00 ETB payment confirmed. Your bid was accepted.');
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'Open Lowwin',web_app:{url:'http://localhost:3000/payments/chapa/return?checkout=0f55aaab-2222-4444-8888-123456789012'}}]]});
 });
 it.each([
  {purpose:'TOP_UP',status:'CREDITED',bidId:null,confirmation:'100.00 ETB credited to your wallet.'},
  {purpose:'BID',status:'BID_ACCEPTED',bidId:'accepted-bid',confirmation:'100.00 ETB payment confirmed. Your bid was accepted.'},
 ])('labels verified TEST funds explicitly for $purpose without changing the owned return link',async({confirmation,...order})=>{
  f.checkout.mockResolvedValue({...order,creditJournalId:'verified-receipt',amountCents:10000n,currency:'ETB',mode:'test'});
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012'},true);
  expect(sent[0].payload.text).toBe('TEST · '+confirmation);
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'Open Lowwin',web_app:{url:'http://localhost:3000/payments/chapa/return?checkout=0f55aaab-2222-4444-8888-123456789012'}}]]});
 });
 it('labels an Amharic TEST confirmation while keeping the authoritative amount',async()=>{
  f.checkout.mockResolvedValue({purpose:'TOP_UP',status:'CREDITED',creditJournalId:'verified-receipt',bidId:null,amountCents:10000n,currency:'ETB',mode:'test'});
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012',from:{id:7,is_bot:false,first_name:'Fixture',language_code:'am'}},true);
  expect(sent[0].payload.text).toBe('ሙከራ (TEST) · 100.00 ETB ወደ ዋሌትዎ ገብቷል።');
 });
 it.each([
  {purpose:'TOP_UP',status:'PENDING',creditJournalId:null,bidId:null},
  {purpose:'TOP_UP',status:'CREDITED',creditJournalId:null,bidId:null},
  {purpose:'BID',status:'BID_ACCEPTED',creditJournalId:'verified-receipt',bidId:null},
  {purpose:'BID',status:'NEEDS_REVIEW',creditJournalId:'verified-receipt',bidId:null},
  {purpose:'TOP_UP',status:'FAILED',creditJournalId:null,bidId:null},
 ])('does not report payment success from an unconfirmed or incomplete outcome %j',async order=>{
  f.checkout.mockResolvedValue({...order,amountCents:10000n,currency:'ETB'});
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012'},true);
  expect(sent[0].payload.text).toBe('Open Lowwin to check your payment. This link does not confirm payment success.');
  expect(sent[0].payload.text).not.toContain('100.00');expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'Check payment',web_app:{url:'http://localhost:3000/payments/chapa/return?checkout=0f55aaab-2222-4444-8888-123456789012'}}]]});
 });
 it.each([{telegramId:'8',botId:TEST_TOKEN.split(':')[0]},{telegramId:'7',botId:'987654321'}])('does not disclose another account or bot payment %j',async owner=>{
  f.checkout.mockImplementation(async({where})=>where.user.telegramId===owner.telegramId&&where.phoneBotId===owner.botId?{purpose:'TOP_UP',status:'CREDITED',creditJournalId:'verified-receipt',bidId:null,amountCents:10000n,currency:'ETB'}:null);
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012'},true);
  expect(sent[0].payload.text).toBe('Open Lowwin to check your payment. This link does not confirm payment success.');expect(sent[0].payload.text).not.toContain('100.00');
 });
 it('keeps the contact gate for payment links and never treats the link as authentication',async()=>{
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012'});
  expect(sent).toHaveLength(1);expect(sent[0].payload.reply_markup).toEqual(CONTACT_REPLY_KEYBOARD);
  expect(f.checkout).not.toHaveBeenCalled();
 });
 it('ignores malformed payment payloads and retains the ordinary launch destination',async()=>{
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012_status_SUCCESS'},true);
  expect(sent).toHaveLength(2);expect(sent[1].payload.reply_markup).toEqual({inline_keyboard:[[{text:'🎯 ጨረታ ይጀምሩ',web_app:{url:'http://localhost:3000'}}]]});
 });
 it.each([
  {from:{id:8,is_bot:false,first_name:'Other'}},
  {from:{id:7,is_bot:true,first_name:'Bot'}},
  {forward_origin:{type:'user',date:1,sender_user:{id:7,is_bot:false,first_name:'Fixture'}}},
 ])('does not send a welcome for an inauthentic private message %j',async change=>expect(await send(change)).toEqual([]));
 it('does not send a Mini App photo in a group',async()=>{const sent=await send({chat:{id:-7,type:'group',title:'Fixture'}});expect(sent.map(x=>x.method)).toEqual(['sendMessage']);expect(sent[0].payload.reply_markup).toBeUndefined()});
});
