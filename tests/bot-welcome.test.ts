import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import type {Update,UserFromGetMe} from 'grammy/types';
import {createBot} from '../src/modules/bot/bot';
import {InputFile} from 'grammy';
import {TEST_TOKEN} from './helpers';
const f=vi.hoisted(()=>({checkout:vi.fn(),referral:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{chapaCheckout:{findFirst:f.checkout}}}));
vi.mock('../src/modules/referrals/service',()=>({recordBotReferralStart:f.referral}));
describe('one-button public Telegram entry',()=>{
 beforeAll(()=>{for(const [key,value] of Object.entries({DATABASE_URL:'postgresql://fixture@127.0.0.1:9/welcome_test',DIRECT_URL:'postgresql://fixture@127.0.0.1:9/welcome_test',APP_ENV:'local',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test/telegram',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two'}))vi.stubEnv(key,value)});
 afterAll(()=>vi.unstubAllEnvs());
 async function send(change:Record<string,unknown>={},verified=false){
  const contactVerified=vi.fn(async()=>verified),bot=createBot({contactVerified}),sent:Array<{method:string;payload:Record<string,unknown>}>=[];
  bot.botInfo={id:123456789,is_bot:true,first_name:'Fixture',username:'lowin_fixture_bot'} as UserFromGetMe;
  bot.api.config.use(async(_prev,method,payload)=>{sent.push({method,payload:payload as unknown as Record<string,unknown>});return {ok:true,result:{message_id:1}} as never});
  await bot.handleUpdate({update_id:1,message:{message_id:1,date:1,chat:{id:7,type:'private'},from:{id:7,is_bot:false,first_name:'Fixture'},text:'/start',entities:[{type:'bot_command',offset:0,length:6}],...change}} as Update);
  return {sent,contactVerified};
 }
 it.each([false,true])('sends one concise welcome and one Open Lowwin button, registered=%s',async verified=>{
  const {sent,contactVerified}=await send({},verified);
  expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendPhoto');expect(sent[0].payload.photo).toBeInstanceOf(InputFile);expect(String(sent[0].payload.caption)).toContain('እንኳን ወደ LowWin');
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'LowWinን ይክፈቱ',web_app:{url:'https://lowwin.test/telegram'}}]]});
  expect(contactVerified).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
 });
 it('uses the Amharic welcome caption with one photo and the same public app action',async()=>{
  const {sent}=await send({from:{id:7,is_bot:false,first_name:'Fixture',language_code:'am'}});
  expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendPhoto');expect(String(sent[0].payload.caption)).toContain('እንኳን ወደ LowWin');expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'LowWinን ይክፈቱ',web_app:{url:'https://lowwin.test/telegram'}}]]});
 });
 it.each(['en','fr',undefined])('keeps the initial welcome Amharic for Telegram UI language %s',async language_code=>{const {sent}=await send({from:{id:7,is_bot:false,first_name:'Fixture',language_code}});expect(String(sent[0].payload.caption)).toContain('እንኳን ወደ LowWin');expect(String(sent[0].payload.caption)).not.toContain('Welcome to');expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'LowWinን ይክፈቱ',web_app:{url:'https://lowwin.test/telegram'}}]]})});
 it('keeps an opaque original payment resume link without claiming success or disclosing a receipt',async()=>{
  const id='0f55aaab-2222-4444-8888-123456789012',{sent}=await send({text:`/start chapa_${id}`});
  expect(sent).toHaveLength(1);expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'LowWinን ይክፈቱ',web_app:{url:`https://lowwin.test/payments/chapa/return?checkout=${id}`}}]]});
  expect(String(sent[0].payload.caption)).not.toMatch(/credited|confirmed|accepted|100\.00/i);expect(f.checkout).not.toHaveBeenCalled();
 });
 it('preserves new-user referral attribution before opening the public app',async()=>{
  f.referral.mockClear();const {sent}=await send({text:'/start ref_opaqueFixture'});
  expect(f.referral).toHaveBeenCalledWith(expect.anything(),'7',TEST_TOKEN.split(':')[0],'ref_opaqueFixture');expect(sent).toHaveLength(1);
 });
 it('does not accept a malformed payment payload as a return route',async()=>{
  const {sent}=await send({text:'/start chapa_0f55aaab-2222-4444-8888-123456789012_status_SUCCESS'});
  expect(sent[0].payload.reply_markup).toEqual({inline_keyboard:[[{text:'LowWinን ይክፈቱ',web_app:{url:'https://lowwin.test/telegram'}}]]});
 });
 it.each([{from:{id:8,is_bot:false,first_name:'Other'}},{from:{id:7,is_bot:true,first_name:'Bot'}},{forward_origin:{type:'user',date:1,sender_user:{id:7,is_bot:false,first_name:'Fixture'}}}])('rejects inauthentic private starts %j',async change=>expect((await send(change)).sent).toEqual([]));
 it('does not expose a Mini App button in a group',async()=>{const {sent}=await send({chat:{id:-7,type:'group',title:'Fixture'}});expect(sent).toHaveLength(1);expect(sent[0].payload.reply_markup).toBeUndefined()});
});
