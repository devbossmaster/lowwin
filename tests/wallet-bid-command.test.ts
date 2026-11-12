import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {QueryClient} from '@tanstack/react-query';
import type {BidBatchQuote,BidBatchReceipt} from '../src/lib/bid-batch-client';
import {ChapaClientError} from '../src/lib/chapa-client';
import {clearWalletBidCommand,readWalletBidCommand,recoverWalletBidCommand,retainWalletBidCommand,submitWalletBidCommand,walletBidCommittedReceipt,WalletBidCommandUnconfirmedError,type WalletBidCommand,type WalletBidCommandOptions} from '../src/lib/wallet-bid-command';

const command:WalletBidCommand={key:'00000000-0000-4000-a000-000000000001',auctionSlug:'wallet-fixture',numbers:['4.25','5.50'],feeVersion:1,approvedTotal:'20.00'};
const quote:BidBatchQuote={id:'00000000-0000-4000-a000-000000000002',quoteHash:'a'.repeat(64),auctionSlug:command.auctionSlug,feeVersion:1,ruleVersion:'lowest-unique-v4',entryCount:2,total:'20.00',totalCents:'2000',grossTotal:'20.00',discountTotal:'0.00',status:'ACCEPTED',lines:command.numbers.map((number,position)=>({position,number,grossFee:'10.00',discount:'0.00',netFee:'10.00'}))};
const receipt:BidBatchReceipt={batch:quote,receipts:quote.lines.map(line=>({bid:{id:`bid-${line.position}`,auctionCode:'LW-TEST',auctionSlug:quote.auctionSlug,amount:line.number,acceptedAt:'2026-11-12T12:00:00.000Z',termsVersion:1,feePoints:'10.00'},charge:{feePoints:'10.00',discountPoints:'0.00',netFeePoints:'10.00',newlyUnavailable:'10.00'}})),wallet:{available:'5.00',held:'0.00',revision:'1'},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'20.00',acceptedBidIds:['bid-0','bid-1']}};
const pending={kind:'pending',status:'PENDING',batchId:quote.id,pollAfterMs:1000};
const defaults={isCurrent:()=>true};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

describe('one-command internal-wallet response and owned receipt recovery',()=>{
 beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
 it('returns a fast committed receipt with one POST and no quote/status request or delay',async()=>{
  const send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockResolvedValue({kind:'receipt',receipt});
  expect(await submitWalletBidCommand({command},{...defaults,request:send})).toEqual({kind:'receipt',receipt});
  expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toBe('/api/payments/chapa/batches/wallet');expect(send.mock.calls[0][1].method).toBe('POST');expect(JSON.parse(send.mock.calls[0][1].body as string)).toEqual(command);expect(send.mock.calls[0][3]).toBe(15000);expect(vi.getTimerCount()).toBe(0);
 });
 it('a slow original response is observed after2s without another mutation and resolves from the committed receipt',async()=>{
  const original=deferred<unknown>(),send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockImplementation((_url,options)=>options.method==='POST'?original.promise:Promise.resolve({kind:'receipt',receipt}));
  const result=submitWalletBidCommand({command},{...defaults,request:send});await vi.advanceTimersByTimeAsync(1999);expect(send).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(await result).toEqual({kind:'receipt',receipt});expect(send).toHaveBeenCalledTimes(2);expect(send.mock.calls[1][0]).toBe(`/api/payments/chapa/batches/wallet?key=${command.key}`);expect(send.mock.calls[1][1].method).toBe('GET');expect(send.mock.calls[0][2].aborted).toBe(true);original.resolve({kind:'receipt',receipt});expect(vi.getTimerCount()).toBe(0);
 });
 it('a lost initial reply checks the same owned key immediately rather than making the customer retry',async()=>{
  const send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockRejectedValueOnce(new TypeError('Synthetic interrupted response')).mockResolvedValueOnce({kind:'receipt',receipt});
  expect(await submitWalletBidCommand({command},{...defaults,request:send})).toEqual({kind:'receipt',receipt});expect(send.mock.calls.map(call=>call[1].method)).toEqual(['POST','GET']);expect(send.mock.calls[1][0]).toContain(command.key);
 });
 it('pending reads back off while a late success resolves the original operation',async()=>{
  const send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockRejectedValueOnce(new ChapaClientError('Synthetic unavailable',503)).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce({kind:'receipt',receipt});
  const result=submitWalletBidCommand({command},{...defaults,request:send});await vi.advanceTimersByTimeAsync(1000);expect(send.mock.calls.filter(call=>call[1].method==='POST')).toHaveLength(1);await vi.advanceTimersByTimeAsync(2000);expect(await result).toEqual({kind:'receipt',receipt});expect(send.mock.calls.filter(call=>call[1].method==='GET')).toHaveLength(3);expect(vi.getTimerCount()).toBe(0);
 });
 it('confirmed insufficient funds is returned immediately without polling or another operation',async()=>{
  const failure=new ChapaClientError('Your wallet balance is too low.',409,'INSUFFICIENT_POINTS',{available:'5.00',required:'20.00',shortfall:'15.00',currency:'ETB'}),send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockRejectedValue(failure);
  await expect(submitWalletBidCommand({command},{...defaults,request:send})).rejects.toBe(failure);expect(send).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('an internal HTTP timeout is uncertain and can still recover a verified owned receipt',async()=>{
  const send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockRejectedValueOnce(new DOMException('Synthetic request timeout','AbortError')).mockResolvedValueOnce({kind:'receipt',receipt});
  await expect(submitWalletBidCommand({command},{...defaults,request:send})).resolves.toEqual({kind:'receipt',receipt});expect(send).toHaveBeenCalledTimes(2);
 });
 it('a caller abort stops requests and does not turn the interrupted attempt into a failure or new debit',async()=>{
  const controller=new AbortController(),original=deferred<unknown>(),send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockReturnValue(original.promise),result=submitWalletBidCommand({command},{...defaults,signal:controller.signal,request:send}).catch(error=>error);
  controller.abort();expect((await result).name).toBe('AbortError');await vi.advanceTimersByTimeAsync(5000);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][2].aborted).toBe(true);original.resolve({kind:'receipt',receipt});expect(vi.getTimerCount()).toBe(0);
 });
 it('account changes prevent receipt observation/acceptance and abort the original client request',async()=>{
  let owned=true;const original=deferred<unknown>(),send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockReturnValue(original.promise),result=submitWalletBidCommand({command},{isCurrent:()=>owned,request:send}).catch(error=>error);
  owned=false;await vi.advanceTimersByTimeAsync(2000);expect((await result).name).toBe('AbortError');expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][2].aborted).toBe(true);original.resolve({kind:'receipt',receipt});
 });
 it('bounded unresolved reads retain uncertainty without automatically repeating POST',async()=>{
  const send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockRejectedValueOnce(new TypeError('Synthetic lost response')).mockResolvedValue(pending),result=submitWalletBidCommand({command},{...defaults,request:send,maxStatusReads:2}).catch(error=>error);
  await vi.advanceTimersByTimeAsync(1000);expect(await result).toBeInstanceOf(WalletBidCommandUnconfirmedError);expect(send.mock.calls.map(call=>call[1].method)).toEqual(['POST','GET','GET']);expect(vi.getTimerCount()).toBe(0);
 });
 it('observer exhaustion does not shorten an outstanding original request timeout',async()=>{
  const original=deferred<unknown>(),send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockImplementation((_url,options)=>options.method==='POST'?original.promise:Promise.resolve(pending));let settled=false;
  const result=submitWalletBidCommand({command},{...defaults,request:send,maxStatusReads:1}).then(value=>{settled=true;return value},error=>{settled=true;return error});await vi.advanceTimersByTimeAsync(2000);expect(settled).toBe(false);expect(send.mock.calls[0][3]).toBe(15000);original.resolve({kind:'receipt',receipt});expect(await result).toEqual({kind:'receipt',receipt});
 });
 it('read-only restoration never POSTs or generates a fresh command/quote',async()=>{
  const send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockResolvedValue({kind:'receipt',receipt});expect(await recoverWalletBidCommand({command},{...defaults,request:send})).toEqual({kind:'receipt',receipt});expect(send.mock.calls.map(call=>call[1].method)).toEqual(['GET']);
  await recoverWalletBidCommand({quote},{...defaults,request:send});expect(send.mock.calls[1][0]).toBe(`/api/payments/chapa/batches/${quote.id}/wallet?quoteHash=${quote.quoteHash}`);
 });
 it('an authoritative changed-price quote returns for another explicit approval without any recovery charge',async()=>{
  const changed={...quote,status:'QUOTED',total:'22.00',totalCents:'2200'},send=vi.fn<NonNullable<WalletBidCommandOptions['request']>>().mockResolvedValue({kind:'quote',quote:changed});expect(await submitWalletBidCommand({command},{...defaults,request:send})).toEqual({kind:'quote',quote:changed});expect(send).toHaveBeenCalledTimes(1);
 });
 it('rejects receipts for a different selection, principal, batch or non-wallet adapter',()=>{
  expect(walletBidCommittedReceipt({kind:'receipt',receipt},{command})).toEqual(receipt);
  for(const mutate of [(copy:BidBatchReceipt)=>{copy.batch.auctionSlug='other'},(copy:BidBatchReceipt)=>{copy.batch.lines[0].number='4.26'},(copy:BidBatchReceipt)=>{copy.payment!.total='21.00'},(copy:BidBatchReceipt)=>{copy.batch.status='QUOTED'},(copy:BidBatchReceipt)=>{copy.receipts[0].bid.id=''},(copy:BidBatchReceipt)=>{copy.payment!.acceptedBidIds=['bid-0','bid-0']}]){const copy=structuredClone(receipt);mutate(copy);expect(walletBidCommittedReceipt({kind:'receipt',receipt:copy},{command})).toBeNull()}
  expect(walletBidCommittedReceipt(receipt,{quote:{...quote,id:'other'}})).toBeNull();expect(walletBidCommittedReceipt({},{command})).toBeNull();
 });
 it('retains the immutable original operation before a batch exists, isolated by account and auction',()=>{
  const client=new QueryClient();retainWalletBidCommand(client,'account-a',command);expect(readWalletBidCommand(client,'account-a',command.auctionSlug)).toEqual(command);expect(readWalletBidCommand(client,'account-b',command.auctionSlug)).toBeNull();expect(readWalletBidCommand(client,'account-a','other')).toBeNull();clearWalletBidCommand(client,'account-a',{...command,key:'other'});expect(readWalletBidCommand(client,'account-a',command.auctionSlug)).not.toBeNull();clearWalletBidCommand(client,'account-a',command);expect(readWalletBidCommand(client,'account-a',command.auctionSlug)).toBeNull();client.clear();
 });
});
