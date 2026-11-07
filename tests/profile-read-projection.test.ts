import type {PrismaClient} from '@prisma/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const f=vi.hoisted(()=>({decrypt:vi.fn(),referral:vi.fn(),user:vi.fn(),liveBids:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> 'fixture-bot',decryptPhone:f.decrypt,normalizePhone:(value:string)=>value}));
vi.mock('../src/modules/referrals/service',()=>({referralSchemaReady:()=>process.env.REFERRAL_REWARDS_SCHEMA_READY==='true',getReferralOverview:f.referral}));
import {getPlayerProfile} from '../src/modules/profile/personal';

const now=new Date('2026-11-07T00:00:00Z');
const row={name:'Telegram name',telegramId:'123',playerProfile:{displayName:'My nickname',bio:'My bio',contactEmail:'owner@example.test',city:'Addis Ababa'},ownContact:{telegramId:'123',botId:'fixture-bot',revokedAt:null,lastFour:'0123',phoneCipher:'private-ciphertext'},_count:{bids:7,wonSettlements:1,favorites:2}};
const tx={$queryRaw:vi.fn(async()=>[{now}]),user:{findUniqueOrThrow:f.user},bid:{count:f.liveBids}};
const client={$transaction:async(read:(value:typeof tx)=>Promise<unknown>)=>read(tx)} as unknown as PrismaClient;
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('REFERRAL_REWARDS_SCHEMA_READY','true');f.user.mockResolvedValue(row);f.liveBids.mockResolvedValue(3);f.decrypt.mockReturnValue('+251911000123');f.referral.mockResolvedValue({configured:false,enabled:false,shareUrl:null})});
afterEach(()=>vi.unstubAllEnvs());

describe('private Profile read projection',()=>{
 it('preserves counts and editable details while excluding stored phone secrets and Telegram bindings',async()=>{
  const result=await getPlayerProfile(client,'owner');
  expect(result).toEqual({displayName:'My nickname',bio:'My bio',contactEmail:'owner@example.test',city:'Addis Ababa',contactDetailsEditable:true,contactVerified:true,phoneDisplay:'+251911000123',counts:{bids:7,liveBids:3,historyBids:4,wins:1,favorites:2},referral:{configured:false,enabled:false,shareUrl:null}});
  const serialized=JSON.stringify(result);expect(serialized).not.toContain('private-ciphertext');expect(serialized).not.toContain('telegramId');
  expect(f.user.mock.calls[0][0].where).toEqual({id:'owner'});expect(f.referral).toHaveBeenCalledWith(client,'owner');
 });
 it('keeps Profile usable before optional contact-detail columns are deployed',async()=>{
  vi.stubEnv('REFERRAL_REWARDS_SCHEMA_READY','false');f.user.mockResolvedValue({...row,playerProfile:{displayName:'My nickname',bio:'My bio'}});
  expect(await getPlayerProfile(client,'owner')).toMatchObject({contactDetailsEditable:false,contactEmail:'',city:''});
  const details=f.user.mock.calls[0][0].select.playerProfile.select;expect(details).not.toHaveProperty('contactEmail');expect(details).not.toHaveProperty('city');
 });
 it('applies current contact binding checks to the joined row before decrypting',async()=>{
  f.user.mockResolvedValue({...row,telegramId:'different-owner'});
  expect(await getPlayerProfile(client,'owner')).toMatchObject({contactVerified:false,phoneDisplay:null});expect(f.decrypt).not.toHaveBeenCalled();
 });
});
