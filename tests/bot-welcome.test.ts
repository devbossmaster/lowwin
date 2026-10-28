import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {InputFile} from 'grammy';
import type {Update, UserFromGetMe} from 'grammy/types';
import {createBot} from '../src/modules/bot/bot';
import {WELCOME_CAPTION,CONTACT_REQUEST_MESSAGE,CONTACT_REPLY_KEYBOARD} from '../src/modules/bot/onboarding-copy';
import {TEST_TOKEN} from './helpers';

describe('private Telegram welcome',()=>{
 beforeAll(()=>{for(const [key,value] of Object.entries({DATABASE_URL:'postgresql://lowin_test@127.0.0.1:55439/welcome_test',DIRECT_URL:'postgresql://lowin_test@127.0.0.1:55439/welcome_test',APP_ENV:'local',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two'}))vi.stubEnv(key,value)});
 afterAll(()=>vi.unstubAllEnvs());
 async function send(change:Record<string,unknown>={},verified=false){
  const bot=createBot({contactVerified:async()=>verified}),sent:Array<{method:string;payload:Record<string,unknown>}>=[];
  bot.botInfo={id:123456789,is_bot:true,first_name:'Fixture',username:'lowin_fixture_bot'} as UserFromGetMe;
  bot.api.config.use(async(_prev,method,payload)=>{sent.push({method,payload:payload as unknown as Record<string,unknown>});return {ok:true,result:{message_id:1}} as never});
  await bot.handleUpdate({update_id:1,message:{message_id:1,date:1,chat:{id:7,type:'private'},from:{id:7,is_bot:false,first_name:'Fixture'},text:'/start',entities:[{type:'bot_command',offset:0,length:6}],...change}} as Update);
  return sent;
 }
 it('uploads the current welcome banner with the exact Amharic caption and inline Mini App button',async()=>{
  const sent=await send({},true);expect(sent).toHaveLength(2);expect(sent[0].method).toBe('sendMessage');expect(sent[0].payload.reply_markup).toEqual({remove_keyboard:true});expect(sent[1].method).toBe('sendPhoto');
  expect(sent[1].payload.photo).toBeInstanceOf(InputFile);expect((sent[1].payload.photo as InputFile).filename).toBe('banner11.png');
  expect(sent[1].payload.caption).toBe(WELCOME_CAPTION);
  expect(sent[1].payload.caption).toContain('📢 ቻናላችን፦ @lowwinet');
  expect(sent[1].payload.caption).toContain('👥 ግሩፓችን፦ @LowWinChat');
  expect(sent[1].payload.reply_markup).toEqual({inline_keyboard:[[{text:'🎯 ጨረታ ይጀምሩ',web_app:{url:'http://localhost:3000'}}]]});
 });
 it('shows new users the private bot contact button before the Mini App launch',async()=>{
  const sent=await send();expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendMessage');
  expect(sent[0].payload.text).toBe(CONTACT_REQUEST_MESSAGE);
  expect(sent[0].payload.reply_markup).toEqual(CONTACT_REPLY_KEYBOARD);
 });
 it('returns the same opaque payment to the authenticated Mini App without reporting success',async()=>{
  const id='0f55aaab-2222-4444-8888-123456789012';
  const sent=await send({text:`/start chapa_${id}`},true);
  expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendMessage');
  expect(sent[0].payload.text).toBe('Open Lowwin to check your payment. This link does not confirm payment success.');
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'Check payment',web_app:{url:`http://localhost:3000/payments/chapa/return?checkout=${id}`}}]]});
 });
 it('keeps the contact gate for payment links and never treats the link as authentication',async()=>{
  const sent=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012'});
  expect(sent).toHaveLength(1);expect(sent[0].payload.reply_markup).toEqual(CONTACT_REPLY_KEYBOARD);
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
