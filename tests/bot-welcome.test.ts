import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {InputFile} from 'grammy';
import type {Update, UserFromGetMe} from 'grammy/types';
import {createBot} from '../src/modules/bot/bot';
import {CONTACT_REQUEST_MESSAGE,CONTACT_REPLY_KEYBOARD} from '../src/modules/bot/onboarding-copy';
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
 it('uploads banner1 with the exact Amharic caption and inline Mini App button',async()=>{
  const sent=await send({},true);expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendPhoto');
  expect(sent[0].payload.photo).toBeInstanceOf(InputFile);expect((sent[0].payload.photo as InputFile).filename).toBe('banner1.png');
  expect(sent[0].payload.caption).toBe('👋 እንኳን ወደ Lowwin በደህና መጡ! በአንድ ሰው ብቻ የቀረበው ዝቅተኛው የጨረታ መጠን ያሸንፋል። ጨረታዎችን ለማየት ሚኒ አፑን ይክፈቱ።');
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'🎯 ጨረታ ይጀምሩ',web_app:{url:'http://localhost:3000'}}]]});
 });
 it('shows new users the private bot contact button before the Mini App launch',async()=>{
  const sent=await send();expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendMessage');
  expect(sent[0].payload.text).toBe(CONTACT_REQUEST_MESSAGE);
  expect(sent[0].payload.reply_markup).toEqual(CONTACT_REPLY_KEYBOARD);
 });
 it.each([
  {from:{id:8,is_bot:false,first_name:'Other'}},
  {from:{id:7,is_bot:true,first_name:'Bot'}},
  {forward_origin:{type:'user',date:1,sender_user:{id:7,is_bot:false,first_name:'Fixture'}}},
 ])('does not send a welcome for an inauthentic private message %j',async change=>expect(await send(change)).toEqual([]));
 it('does not send a Mini App photo in a group',async()=>{const sent=await send({chat:{id:-7,type:'group',title:'Fixture'}});expect(sent.map(x=>x.method)).toEqual(['sendMessage']);expect(sent[0].payload.reply_markup).toBeUndefined()});
});
