import {Prisma as MoneyPrisma} from '@prisma/client';
import {verifyFixtureContact} from './contact-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { creditDevelopmentPoints, ensureWallet, reconcile } from '../src/modules/wallet/ledger';
import { receiveUpdate } from '../src/modules/bot/webhook';
import { signedLaunch, TEST_TOKEN, LOCAL_ACCESS_KEY } from './helpers';

const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)('isolated PostgreSQL foundation', () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Tests require an isolated loopback database ending in _test');
    Object.assign(process.env, { DATABASE_URL: testUrl, DIRECT_URL: testUrl, APP_ENV: 'local', NODE_ENV: 'test', DEV_POINTS_ENABLED: 'true', DEV_IDENTITY_ENABLED: 'true', BETTER_AUTH_URL:'http://localhost:3000', MINI_APP_URL:'http://localhost:3000', BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters', TELEGRAM_BOT_TOKEN:TEST_TOKEN, TELEGRAM_BOT_USERNAME:'lowin_fixture_bot', TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two' });
    process.env.DEV_IDENTITY_ACCESS_KEY = LOCAL_ACCESS_KEY;
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
    client = new PrismaClient();
    await client.rateLimit.deleteMany();
    userId = randomUUID();
    await client.user.create({data:{id:userId,name:'Ledger test'}});
  },60000);
  afterAll(async()=>{await client?.$disconnect(); const { db } = await import('../src/lib/db'); await db.$disconnect();});
  it('records an immutable 1:1 ETB conversion without rewriting wallet postings',async()=>{
    const rows=await client.$queryRaw<{id:string;numerator:bigint;denominator:bigint}[]>`SELECT id,numerator,denominator FROM "CurrencyConversion"`;
    expect(rows).toEqual([{id:'legacy-points-etb-v1',numerator:1n,denominator:1n}]);
    const before=await client.journal.count();
    await expect(client.$executeRaw`UPDATE "CurrencyConversion" SET "reason"='changed' WHERE id='legacy-points-etb-v1'`).rejects.toThrow();
    expect(await client.journal.count()).toBe(before);
    expect(await reconcile(client)).toEqual([]);
  });
  it('credits once, returns the original result, rejects changed-key reuse',async()=>{
    const first = await creditDevelopmentPoints(client,userId,'1000','same-seed-key');
    expect(await creditDevelopmentPoints(client,userId,'1000','same-seed-key')).toEqual(first);
    await expect(creditDevelopmentPoints(client,userId,'2000','same-seed-key')).rejects.toThrow('Idempotency');
    expect(await client.operation.count({where:{userId}})).toBe(1);
    expect(await reconcile(client)).toEqual([]);
  });
  it('serializes concurrent wallet operations without lost projection updates',async()=>{
    await Promise.all(Array.from({length:6},(_,i)=>creditDevelopmentPoints(client,userId,'10',`parallel-seed-${i}`)));
    expect((await client.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}})).balance?.toString()).toBe("1060");
    expect(await reconcile(client)).toEqual([]);
  });
  it('serializes concurrent retries into one journal',async()=>{
    const results = await Promise.all(Array.from({length:4},()=>creditDevelopmentPoints(client,userId,'5','parallel-same-key')));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await client.operation.count({where:{userId,key:'parallel-same-key'}})).toBe(1);
  });
  async function rawJournal(deltas: bigint[]) {
    return client.$transaction(async tx=>{
      const op = await tx.operation.create({data:{userId,scope:'TEST',key:randomUUID(),requestHash:'test',result:{}}});
      const available = await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}});
      const issuance = await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}});
      return tx.journal.create({data:{operationId:op.id,kind:'TEST',reference:'invariant-test',postings:{create:deltas.map((delta,i)=>({accountId:i===0?available.id:issuance.id,delta:delta.toString()}))}}});
    });
  }
  it('rejects an unbalanced journal, including an empty journal',async()=>{
    await expect(rawJournal([10n,-9n])).rejects.toThrow();
    await expect(rawJournal([])).rejects.toThrow();
    expect(await reconcile(client)).toEqual([]);
  });
  it('rejects overdrafts atomically',async()=>{await expect(rawJournal([-100000n,100000n])).rejects.toThrow();expect(await reconcile(client)).toEqual([]);});
  it('rejects editing/deleting postings and bypassing the projection',async()=>{
    const op = await client.operation.findFirstOrThrow({where:{userId}});
    const journal = await client.journal.findUniqueOrThrow({where:{operationId:op.id}});
    const posting = await client.posting.findFirstOrThrow({where:{journalId:journal.id}});
    await expect(client.posting.update({where:{id:posting.id},data:{delta:new MoneyPrisma.Decimal("99")}})).rejects.toThrow();
    await expect(client.posting.delete({where:{id:posting.id}})).rejects.toThrow();
    await expect(client.journal.update({where:{id:journal.id},data:{reference:'edited'}})).rejects.toThrow();
    await expect(client.operation.update({where:{id:op.id},data:{result:{changed:true}}})).rejects.toThrow();
    await expect(client.ledgerAccount.update({where:{id:posting.accountId},data:{balance:new MoneyPrisma.Decimal("99999")}})).rejects.toThrow();
    const held = await client.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:held`}});
    await expect(client.posting.create({data:{journalId:journal.id,accountId:held.id,delta:new MoneyPrisma.Decimal("1")}})).rejects.toThrow();
  });
  it('enforces wallet ownership and nonnegative holds',async()=>{
    const wallet = await client.$transaction(tx=>ensureWallet(tx,userId));
    await expect(client.wallet.create({data:{userId}})).rejects.toThrow();
    const auction = await client.auction.create({data:{code:randomUUID()}});
    await expect(client.auctionHold.create({data:{walletId:wallet.id,auctionId:auction.id,points:new MoneyPrisma.Decimal("-1")}})).rejects.toThrow();
  });
  it('accepts duplicate webhook retries once and rejects a wrong secret',async()=>{
    const updateId = Math.floor(Math.random()*1000000000);
    const req = (secret:string)=>new Request('http://localhost:3000/api/bot/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify({update_id:updateId})});
    expect((await receiveUpdate(req('wrong'),client,'right')).status).toBe(403);
    await Promise.all([receiveUpdate(req('right'),client,'right'),receiveUpdate(req('right'),client,'right')]);
    expect(await client.botUpdate.count({where:{updateId}})).toBe(1);
  });
  it('uses the real pinned plugin, returns secure session semantics and one stable opaque user',async()=>{
    const { handleAuth } = await import('../src/modules/auth/handler');
    const telegramId = 4000000000 + Math.floor(Math.random()*1000000000);
    await verifyFixtureContact(client,telegramId);
    const launch = signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Verified fixture'})});
    const req=()=>new Request('http://localhost:3000/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({initData:launch})});
    const responses = await Promise.all([handleAuth(req()),handleAuth(req()),handleAuth(req())]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const body=await response.clone().json();
      expect(body).toMatchObject({ok:true,status:'authenticated',me:{user:{name:'Lowwin player'}}});
      expect(body).not.toHaveProperty('session');
      expect(body).not.toHaveProperty('token');
      expect(response.headers.get('set-cookie')).toContain('HttpOnly');
      expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    }
    const users = await client.user.findMany({where:{telegramId:String(telegramId)}});
    expect(users).toHaveLength(1); expect(users[0].id).not.toBe(String(telegramId));
    expect(await client.account.count({where:{userId:users[0].id}})).toBe(1);
    const { createAuth } = await import('../src/modules/auth/server');
    const cookie = responses[0].headers.get('set-cookie')!.split(';')[0];
    const session = await createAuth().api.getSession({headers:new Headers({cookie})});
    expect(session?.user.id).toBe(users[0].id);
    expect(await createAuth().api.getSession({headers:new Headers()})).toBeNull();
    const { GET } = await import('../src/app/api/me/route');
    expect((await GET(new Request('http://localhost:3000/api/me'))).status).toBe(401);
    expect((await GET(new Request('http://localhost:3000/api/me',{headers:{cookie}}))).status).toBe(200);
  });
  it('rejects tampered auth before user creation and blocks unexposed plugin routes',async()=>{
    const {handleAuth}=await import('../src/modules/auth/handler');
    const req=(path:string,initData:string,origin='http://localhost:3000')=>new Request(`http://localhost:3000/api/auth${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({initData})});
    for (const launch of ['',signedLaunch({auth_date:'100'}),signedLaunch({},'wrong-bot')]) expect((await handleAuth(req('/telegram/miniapp/signin',launch))).status).toBe(401);
    expect((await handleAuth(req('/telegram/miniapp/signin',signedLaunch(),'https://evil.invalid'))).status).toBe(403);
    expect((await handleAuth(req('/telegram/link',signedLaunch()))).status).toBe(404);
  });
  it('reuses the explicit local identity and never assigns it a Telegram ID',async()=>{
    const {handleAuth}=await import('../src/modules/auth/handler');
    const request=()=>new Request('http://localhost:3000/api/auth/lowin/dev-identity',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({accessKey:LOCAL_ACCESS_KEY})});
    expect((await handleAuth(request())).status).toBe(200);
    expect((await handleAuth(request())).status).toBe(200);
    const user=await client.user.findUniqueOrThrow({where:{email:'local-test@lowin.invalid'}});
    expect(user.telegramId).toBeNull();
  });
  it('processes queued bot commands once across workers and retries failed delivery',async()=>{
    const {processOneUpdate}=await import('../src/modules/bot/worker');
    const {Bot}=await import('grammy');
    const {createBot}=await import('../src/modules/bot/bot');
    // Ignore leftover fixture-only inbox entries from earlier tests in this disposable DB.
    await client.botUpdate.updateMany({where:{processedAt:null},data:{processedAt:new Date(),payload:{}}});
    const bot=createBot({contactVerified:async()=>true});
    bot.botInfo={id:123456789,is_bot:true,first_name:'Lowwin test',username:'lowin_fixture_bot',can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:true,has_topics_enabled:false,allows_users_to_create_topics:false};
    const sent:Array<{method:string,payload:Record<string,unknown>}>=[];
    bot.api.config.use(async(_prev,method,payload)=>{sent.push({method,payload:payload as unknown as Record<string,unknown>});return {ok:true,result:{message_id:1}} as never;});
    const updateId=Date.now();
    await client.botUpdate.create({data:{updateId,payload:{update_id:updateId,message:{message_id:1,date:Math.floor(Date.now()/1000),chat:{id:1,type:'private'},from:{id:1,is_bot:false,first_name:'Fixture'},text:'/start',entities:[{type:'bot_command',offset:0,length:6}]}}}});
    await Promise.all([processOneUpdate(client,bot),processOneUpdate(client,bot)]);
    expect(sent).toHaveLength(2);expect(sent[0].method).toBe('sendMessage');expect(sent[0].payload.reply_markup).toEqual({remove_keyboard:true});expect(sent[1].method).toBe('sendPhoto');
    expect(sent[1].payload.reply_markup).toMatchObject({inline_keyboard:expect.arrayContaining([expect.arrayContaining([expect.objectContaining({web_app:{url:process.env.MINI_APP_URL}})])])});
    expect((await client.botUpdate.findUniqueOrThrow({where:{updateId}})).processedAt).not.toBeNull();
    const failureId=updateId+1;
    await client.botUpdate.create({data:{updateId:failureId,payload:{update_id:failureId}}});
    const failing={handleUpdate:async()=>{throw new Error('fixture failure');}} as unknown as InstanceType<typeof Bot>;
    await processOneUpdate(client,failing);
    const failed=await client.botUpdate.findUniqueOrThrow({where:{updateId:failureId}});
    expect(failed.attempts).toBe(1);expect(failed.processedAt).toBeNull();expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('issues Secure cookies over HTTPS and rejects dev identity on production',async()=>{
    const {handleAuth}=await import('../src/modules/auth/handler');
    process.env.BETTER_AUTH_URL='https://lowin.example';process.env.MINI_APP_URL='https://lowin.example';
    process.env.DEV_IDENTITY_ENABLED='false';
    try {
      const response=await handleAuth(new Request('https://lowin.example/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'https://lowin.example','content-type':'application/json'},body:JSON.stringify({initData:signedLaunch()})}));
      expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('Secure');
      Object.assign(process.env,{NODE_ENV:'production',DEV_POINTS_ENABLED:'false',DEV_IDENTITY_ENABLED:'false'});
      const forbidden=await handleAuth(new Request('https://lowin.example/api/auth/lowin/dev-identity',{method:'POST',headers:{origin:'https://lowin.example'},body:'{}'}));
      expect(forbidden.status).toBe(503); // Production also rejects fixture credentials.
    } finally { Object.assign(process.env,{NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'true',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000'}); }
  });
});
