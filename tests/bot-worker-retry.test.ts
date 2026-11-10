import {beforeEach,describe,expect,it,vi} from 'vitest';
import {BotError,type Bot,type Context} from 'grammy';
import type {PrismaClient} from '@prisma/client';
import {processOneUpdate} from '../src/modules/bot/worker';
import {TelegramRateDeferredError} from '../src/modules/notifications/telegram-rate';

vi.mock('../src/modules/auth/own-contact',()=>({acceptOwnContact:async()=>null}));
const payload={update_id:1,message:{message_id:1,date:1,text:'/help',chat:{id:123,type:'private'},from:{id:123,is_bot:false,first_name:'Fixture'}}};
function fixture(cause:unknown){
 const update=vi.fn(),finish=vi.fn(),block=vi.fn(),tx={$queryRaw:async()=>[{updateId:1n,payload,attempts:0,botId:'999'}],botUpdate:{update}};
 const db={$transaction:async(run:(tx:unknown)=>Promise<unknown>)=>run(tx),botUpdate:{updateMany:finish},botChat:{updateMany:block}} as unknown as PrismaClient;
 const bot={handleUpdate:vi.fn(async()=>{throw new BotError(cause,{update:payload} as Context)})} as unknown as Bot;
 return{db,bot,update,finish,block};
}
beforeEach(()=>vi.clearAllMocks());
describe('command sender honors the shared budget without consuming delivery retries',()=>{
 it('unwraps grammY failures and durably defers an unattempted send',async()=>{
  const retryAt=new Date(Date.now()+20000),f=fixture(new TelegramRateDeferredError(retryAt));
  expect(await processOneUpdate(f.db,f.bot)).toBe(true);
  expect(f.finish).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({updateId:1n,processedAt:null,nextAttemptAt:expect.any(Date)}),data:{attempts:{decrement:1},nextAttemptAt:retryAt,lastError:'Telegram command waiting for shared rate budget'}}));
  expect(f.block).not.toHaveBeenCalled();
 });
 it('waits at least the provider retry_after after an actual 429',async()=>{
  const start=Date.now(),f=fixture({error_code:429,parameters:{retry_after:60}});await processOneUpdate(f.db,f.bot);
  const data=f.finish.mock.calls[0][0].data;expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(start+60000);expect(data.processedAt).toBeUndefined();expect(data.lastError).toBe('Telegram command rate limited');
 });
 it('ends permanent forbidden deliveries and marks the registered chat blocked',async()=>{
  const f=fixture({error_code:403});await processOneUpdate(f.db,f.bot);
  expect(f.finish).toHaveBeenCalledWith(expect.objectContaining({data:{processedAt:expect.any(Date),payload:{},lastError:'Telegram command chat blocked'}}));
  expect(f.block).toHaveBeenCalledWith({where:{chatId:'123'},data:{blocked:true}});
 });
});
