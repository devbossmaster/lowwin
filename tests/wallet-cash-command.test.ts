import {describe,expect,it,vi} from 'vitest';
import {Prisma,type PrismaClient} from '@prisma/client';
import {runAtomicCashWalletCommand,type WalletCashCommandInput} from '../src/modules/auctions/wallet-cash-command';
import {chapaHash} from '../src/modules/payments/chapa-provider';
const binding={sessionId:'fixture-session',sessionToken:'fixture-token',userId:'fixture-owner',telegramId:'8123456789',telegramAuthSource:'MINI_APP',botId:'123456789'};
const input:WalletCashCommandInput={key:'00000000-0000-4000-a000-000000000001',auctionSlug:'cash-fixture',numbers:['4.25','5.50'],feeVersion:1,approvedTotal:'20.00',requestHash:'a'.repeat(64)};
const databaseError=(code:string,message:string)=>new Prisma.PrismaClientKnownRequestError('Raw query failed',{code:'P2010',clientVersion:'6.19.3',meta:{code,message}});
function client(error?:unknown,value:unknown=null){const query=error?vi.fn().mockRejectedValue(error):vi.fn().mockResolvedValue([{result:value}]);return {query,db:{$queryRaw:query} as unknown as PrismaClient}}
describe('cash wallet command rollout and ambiguity boundaries',()=>{
 it('uses only one bound parameterized command and retains canonical published-rule hashes',async()=>{
  const {db,query}=client();expect(await runAtomicCashWalletCommand(db,binding,binding.userId,input)).toBeNull();expect(query).toHaveBeenCalledOnce();
  const [sql,proof,json]=query.mock.calls[0],payload=JSON.parse(json);expect(sql.join('')).toContain('public.lowwin_cash_wallet_batch(');expect(JSON.parse(proof)).toEqual(binding);
  for(const ruleVersion of ['lowest-unique-v4','lowest-unique-v5'])expect(payload.quoteHashes[ruleVersion]).toBe(chapaHash(JSON.stringify({id:payload.batchId,userId:binding.userId,ruleVersion,feeVersion:1,lines:payload.lines,totalCents:'2000'})));
  expect(payload.children.map((child:{numberText:string})=>child.numberText)).toEqual(['4.25','5.5']);expect(payload.notice.body).toContain('20.00');
 });
 it('falls back only for PostgreSQL explicitly reporting this exact optional entrypoint missing',async()=>{
  const {db,query}=client(databaseError('42883','function public.lowwin_cash_wallet_batch(jsonb, jsonb) does not exist'));
  expect(await runAtomicCashWalletCommand(db,binding,binding.userId,input)).toBeNull();expect(query).toHaveBeenCalledOnce();
 });
 it('recognizes the actual Prisma PostgreSQL ERROR prefix for the named missing entrypoint',async()=>{
  const {db,query}=client(databaseError('42883','ERROR: function public.lowwin_cash_wallet_batch(jsonb, jsonb) does not exist\nHINT: No function matches the given name and argument types.'));
  expect(await runAtomicCashWalletCommand(db,binding,binding.userId,input)).toBeNull();expect(query).toHaveBeenCalledOnce();
 });
 for(const error of [databaseError('42883','function other_internal_function(jsonb) does not exist'),databaseError('57014','canceling statement due to statement timeout'),databaseError('42501','permission denied for function lowwin_cash_wallet_batch'),new TypeError('Lost connection after command dispatch')])it(`preserves an uncertain/unsupported database error without another mutation: ${error.message}`,async()=>{
  const {db,query}=client(error);await expect(runAtomicCashWalletCommand(db,binding,binding.userId,input)).rejects.toBe(error);expect(query).toHaveBeenCalledOnce();
 });
 it('rejects a malformed committed reply instead of interpreting it as an unsupported safe fallback',async()=>{
  const {db,query}=client(undefined,{kind:'receipt',receipt:{batch:{status:'ACCEPTED'}}});await expect(runAtomicCashWalletCommand(db,binding,binding.userId,input)).rejects.toThrow('exact committed receipt');expect(query).toHaveBeenCalledOnce();
 });
 it('does not query another identity or an ineligible draft',async()=>{
  const {db,query}=client();await expect(runAtomicCashWalletCommand(db,binding,'another-owner',input)).rejects.toMatchObject({status:401});expect(await runAtomicCashWalletCommand(db,binding,binding.userId,{...input,numbers:['0.50']})).toBeNull();expect(query).not.toHaveBeenCalled();
 });
});
