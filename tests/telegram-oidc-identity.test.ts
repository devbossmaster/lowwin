import {randomInt,randomUUID} from 'node:crypto';
import {PrismaClient,type Prisma} from '@prisma/client';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {prepareTelegramOIDCIdentity,type VerifiedTelegramOIDCProfile} from '../src/modules/auth/telegram-oidc-identity';
import {acceptOwnContact,decryptPhone,protectContactPayload} from '../src/modules/auth/own-contact';
import {creditDevelopmentPoints} from '../src/modules/wallet/ledger';
import {readWalletBalance} from '../src/modules/wallet/balance';
import {TEST_TOKEN} from './helpers';

const database=process.env.TELEGRAM_BROWSER_TEST_DATABASE_URL;
const settings={clientId:'123456789'},issuer='https://oauth.telegram.org';

describe.skipIf(!database)('LowWin identity policy for upstream verified Telegram OIDC profiles',()=>{
 let db:PrismaClient;
 beforeAll(()=>{
  const target=new URL(database!);
  if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,APP_ENV:'local',NODE_ENV:'test',TELEGRAM_BOT_TOKEN:TEST_TOKEN,PHONE_CONTACT_KEY_ID:'fixture-oidc-identity',PHONE_CONTACT_KEYS:JSON.stringify({'fixture-oidc-identity':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'false',DEV_POINTS_ENABLED:'true'});
  db=new PrismaClient();
 });
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 function profile(patch:Partial<VerifiedTelegramOIDCProfile>={}):VerifiedTelegramOIDCProfile{
  const id=String(randomInt(4000000000,5000000000));
  return {iss:issuer,aud:settings.clientId,sub:'synthetic-upstream-'+randomUUID(),id,name:'Synthetic upstream member',preferred_username:'fixture_member',phone_number:'2519'+id.slice(-8),phone_number_verified:true,...patch};
 }
 const prepare=(claims:VerifiedTelegramOIDCProfile)=>prepareTelegramOIDCIdentity(claims,settings,db);
 async function member(claims:VerifiedTelegramOIDCProfile){return db.user.findUniqueOrThrow({where:{telegramId:String(claims.id)}})}
 async function botContact(claims:VerifiedTelegramOIDCProfile){
  const id=Number(claims.id),payload=protectContactPayload({message:{chat:{id,type:'private'},from:{id,first_name:'Bot member'},contact:{user_id:id,phone_number:claims.phone_number}}},settings.clientId);
  expect(await db.$transaction(tx=>acceptOwnContact(tx,payload,settings.clientId,BigInt(randomInt(100000000000,200000000000))))).toBe('VERIFIED');
 }
 async function expectNoIdentity(claims:VerifiedTelegramOIDCProfile){
  expect(await db.user.count({where:{telegramId:String(claims.id)}})).toBe(0);
  expect(await db.account.count({where:{providerId:'telegram-oidc',accountId:claims.sub}})).toBe(0);
  expect(await db.telegramOwnContact.count({where:{telegramId:String(claims.id)}})).toBe(0);
 }

 it('prepares one canonical member and encrypted phone proof without issuing sessions or money',async()=>{
  const claims=profile({name:'  Synthetic\u0000 member  ',picture:'https://cdn.example/fixture.webp'});
  expect(await prepare(claims)).toEqual({name:'Synthetic member',image:'https://cdn.example/fixture.webp'});
  const user=await member(claims),contact=await db.telegramOwnContact.findUniqueOrThrow({where:{userId:user.id}});
  expect(user).toMatchObject({role:'member',telegramId:claims.id,telegramUsername:'fixture_member',telegramPhoneNumber:null});
  expect(contact).toMatchObject({verificationSource:'TELEGRAM_OIDC',sourceUpdateId:null,oidcIssuer:issuer,oidcSubject:claims.sub});
  expect(contact.phoneCipher).not.toContain(claims.phone_number!);expect(decryptPhone(contact.phoneCipher,settings.clientId)).toBe('+'+claims.phone_number);
  expect(await db.account.findMany({where:{userId:user.id},select:{providerId:true,accountId:true,telegramId:true}})).toEqual(expect.arrayContaining([{providerId:'telegram',accountId:claims.id,telegramId:claims.id},{providerId:'telegram-oidc',accountId:claims.sub,telegramId:claims.id}]));
  expect(await db.session.count({where:{userId:user.id}})).toBe(0);expect(await db.operation.count({where:{userId:user.id}})).toBe(0);expect(await db.wallet.count({where:{userId:user.id}})).toBe(0);
 });
 it('accepts safe numeric profile fixtures while keeping the signed opaque subject separate',async()=>{
  const claims=profile({id:randomInt(4000000000,5000000000)});await prepare(claims);
  expect((await member(claims)).telegramId).toBe(String(claims.id));
  expect((await db.account.findUniqueOrThrow({where:{providerId_accountId:{providerId:'telegram-oidc',accountId:claims.sub}}})).telegramId).toBe(String(claims.id));
 });
 it.each([{phone_number_verified:false},{phone_number_verified:undefined},{phone_number:undefined},{phone_number:'invalid-phone'}])('requires confirmed usable phone consent before new contact creation: %j',async patch=>{
  const claims=profile(patch);await expect(prepare(claims)).rejects.toMatchObject({body:{code:'contact_required'}});await expectNoIdentity(claims);
 });
 it('rejects a truthy string in place of verified phone evidence',async()=>{
  const claims=profile({phone_number_verified:'true' as unknown as boolean});await expect(prepare(claims)).rejects.toMatchObject({body:{code:'contact_required'}});await expectNoIdentity(claims);
 });
 it.each([{id:'000123'},{id:'not-a-telegram-id'},{id:9007199254740992},{id:undefined},{iss:'https://attacker.example'},{aud:'987654321'},{sub:''},{sub:'x'.repeat(201)}])('fails malformed or differently scoped profiles before identity writes: %j',async patch=>{
  const claims=profile(patch);await expect(prepare(claims)).rejects.toMatchObject({body:{code:'invalid'}});await expectNoIdentity(claims);
 });
 it('restores an existing bot member and balance while preserving its original phone proof',async()=>{
  const claims=profile();await botContact(claims);const user=await member(claims),before=await db.telegramOwnContact.findUniqueOrThrow({where:{userId:user.id}});
  await creditDevelopmentPoints(db,user.id,'83.25','upstream-oidc-preserve-'+user.id);
  await prepare({...claims,phone_number:'251711000001',phone_number_verified:false});
  expect((await member(claims)).id).toBe(user.id);expect(await db.telegramOwnContact.findUniqueOrThrow({where:{userId:user.id}})).toEqual(before);
  expect((await readWalletBalance(db,user.id)).available).toBe('83.25');expect(await db.user.count({where:{telegramId:String(claims.id)}})).toBe(1);
 });
 it('preserves a same-owner legacy bot-prefixed OIDC record and adds only the upstream raw-sub binding',async()=>{
  const claims=profile();await botContact(claims);const user=await member(claims),legacy=await db.account.create({data:{id:randomUUID(),providerId:'telegram-oidc',accountId:settings.clientId+':'+claims.sub,userId:user.id,telegramId:String(claims.id)}});
  await prepare(claims);expect(await db.account.findUniqueOrThrow({where:{id:legacy.id}})).toEqual(legacy);
  expect((await db.account.findUniqueOrThrow({where:{providerId_accountId:{providerId:'telegram-oidc',accountId:claims.sub}}})).userId).toBe(user.id);
  expect(await db.session.count({where:{userId:user.id}})).toBe(0);
 });
 it('serializes repeated and concurrent preparations into one member, one contact and two canonical accounts',async()=>{
  const claims=profile();await Promise.all([prepare(claims),prepare(claims),prepare(claims)]);const user=await member(claims);
  expect(await db.user.count({where:{telegramId:String(claims.id)}})).toBe(1);expect(await db.telegramOwnContact.count({where:{userId:user.id}})).toBe(1);expect(await db.account.count({where:{userId:user.id}})).toBe(2);
 });
 it('serializes simultaneous bot contact registration and browser mapping into the same member',async()=>{
  const claims=profile(),id=Number(claims.id),updateId=BigInt(randomInt(100000000000,200000000000));
  const payload=protectContactPayload({message:{chat:{id,type:'private'},from:{id,first_name:'Concurrent bot member'},contact:{user_id:id,phone_number:claims.phone_number}}},settings.clientId);
  const [,outcome]=await Promise.all([prepare(claims),db.$transaction(tx=>acceptOwnContact(tx,payload,settings.clientId,updateId))]);
  expect(['VERIFIED','ALREADY_VERIFIED']).toContain(outcome);const user=await member(claims);
  expect(await db.user.count({where:{telegramId:String(claims.id)}})).toBe(1);expect(await db.account.count({where:{userId:user.id}})).toBe(2);
  expect(await db.telegramOwnContact.findUniqueOrThrow({where:{userId:user.id}})).toMatchObject({verificationSource:'BOT_CONTACT',sourceUpdateId:updateId,oidcIssuer:null,oidcSubject:null});
  expect(await db.session.count({where:{userId:user.id}})).toBe(0);
 });
 it('never merges a new Telegram identity into another member by phone',async()=>{
  const first=profile();await prepare(first);const second=profile({phone_number:first.phone_number});
  await expect(prepare(second)).rejects.toMatchObject({body:{code:'conflict'}});await expectNoIdentity(second);expect((await member(first)).telegramId).toBe(String(first.id));
 });
 it('rejects a raw-sub binding to a different Telegram owner',async()=>{
  const first=profile();await prepare(first);const second=profile({sub:first.sub});
  await expect(prepare(second)).rejects.toMatchObject({body:{code:'conflict'}});expect(await db.user.count({where:{telegramId:String(second.id)}})).toBe(0);
 });
 it('rejects a legacy binding owned by another member without moving or deleting it',async()=>{
  const first=profile();await prepare(first);const owner=await member(first),second=profile();
  const legacy=await db.account.create({data:{id:randomUUID(),providerId:'telegram-oidc',accountId:settings.clientId+':'+second.sub,userId:owner.id,telegramId:String(first.id)}});
  await expect(prepare(second)).rejects.toMatchObject({body:{code:'conflict'}});await expectNoIdentity(second);expect(await db.account.findUniqueOrThrow({where:{id:legacy.id}})).toEqual(legacy);
 });
 it('never revives revoked contact proof',async()=>{
  const claims=profile();await prepare(claims);const user=await member(claims);await db.telegramOwnContact.update({where:{userId:user.id},data:{revokedAt:new Date()}});
  await expect(prepare(claims)).rejects.toMatchObject({body:{code:'conflict'}});expect((await db.telegramOwnContact.findUniqueOrThrow({where:{userId:user.id}})).revokedAt).not.toBeNull();
 });
 it('does not provision customer identity for a staff/admin account',async()=>{
  const claims=profile();await db.user.create({data:{id:randomUUID(),telegramId:String(claims.id),name:'Synthetic admin',role:'admin'}});
  await expect(prepare(claims)).rejects.toMatchObject({body:{code:'conflict'}});expect(await db.telegramOwnContact.count({where:{telegramId:String(claims.id)}})).toBe(0);expect(await db.account.count({where:{accountId:claims.sub}})).toBe(0);
 });
 it('rolls back every prepared identity write when the final account write fails',async()=>{
  const claims=profile(),wrapped={$transaction:(task:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:{maxWait:number;timeout:number})=>db.$transaction(async tx=>{
   const original=tx.account.create.bind(tx.account),account={...tx.account,create:async(args:Parameters<typeof tx.account.create>[0])=>{if(args.data.providerId==='telegram-oidc')throw Error('synthetic-commit-failure');return original(args)}};
   return task(new Proxy(tx,{get(target,key,receiver){return key==='account'?account:Reflect.get(target,key,receiver)}}));
  },options)} as unknown as PrismaClient;
  await expect(prepareTelegramOIDCIdentity(claims,settings,wrapped)).rejects.toThrow('synthetic-commit-failure');await expectNoIdentity(claims);expect(await db.account.count({where:{providerId:'telegram',accountId:String(claims.id)}})).toBe(0);
 });
});
