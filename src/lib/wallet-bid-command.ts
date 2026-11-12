import type {QueryClient} from '@tanstack/react-query';
import type {BidBatchQuote,BidBatchReceipt} from './bid-batch-client';
import {normalizeBidDraft} from './bid-batch-client';
import {ChapaClientError,requestChapaJson} from './chapa-client';
import {etbToCents} from './money';

export type WalletBidCommand={key:string;auctionSlug:string;numbers:string[];feeVersion:number;couponId?:string;approvedTotal:string};
export type WalletBidTarget={command:WalletBidCommand}|{quote:BidBatchQuote};
export type WalletBidCommandResult={kind:'receipt';receipt:BidBatchReceipt}|{kind:'quote';quote:BidBatchQuote};
type Request=(url:string,options:RequestInit,signal:AbortSignal,timeoutMs:number)=>Promise<unknown>;
export type WalletBidCommandOptions={signal?:AbortSignal;isCurrent:()=>boolean;request?:Request;probeAfterMs?:number;recoveryWindowMs?:number;maxStatusReads?:number;now?:()=>number;wait?:(ms:number,signal:AbortSignal)=>Promise<void>};
const receiptPath='/api/payments/chapa/batches/wallet';
const request:Request=(url,options,signal,timeoutMs)=>requestChapaJson<unknown>(url,options,signal,timeoutMs);
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const amount=(value:unknown)=>typeof value==='string'&&/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value);
const interrupted=()=>new DOMException('Wallet payment observation interrupted.','AbortError');
function current(options:WalletBidCommandOptions,signal:AbortSignal){if(signal.aborted||!options.isCurrent())throw interrupted()}
function wait(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(interrupted());return}const aborted=()=>{clearTimeout(timer);reject(interrupted())},timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve()},ms);signal.addEventListener('abort',aborted,{once:true})})}
function selection(target:WalletBidTarget){return 'command'in target?{slug:target.command.auctionSlug,numbers:target.command.numbers,feeVersion:target.command.feeVersion,total:target.command.approvedTotal}:{slug:target.quote.auctionSlug,numbers:target.quote.lines.map(line=>line.number),feeVersion:target.quote.feeVersion,total:target.quote.total}}
function matchesQuote(value:unknown,target:WalletBidTarget):value is BidBatchQuote{
 const quote=object(value),expected=selection(target);if(!quote||typeof quote.id!=='string'||typeof quote.quoteHash!=='string'||quote.auctionSlug!==expected.slug||quote.feeVersion!==expected.feeVersion||!amount(quote.total)||!Array.isArray(quote.lines)||quote.lines.length!==expected.numbers.length)return false;
 if('quote'in target&&(quote.id!==target.quote.id||quote.quoteHash!==target.quote.quoteHash))return false;
 return quote.lines.every((line,index)=>{const item=object(line);return item?.position===index&&typeof item.number==='string'&&normalizeBidDraft(item.number)===normalizeBidDraft(expected.numbers[index])});
}
/** Accept only this owned operation's committed internal-wallet receipt.
 * An untyped/partial HTTP success is not a financial result. */
export function walletBidCommittedReceipt(value:unknown,target:WalletBidTarget):BidBatchReceipt|null{
 const envelope=object(value),data=envelope?.kind==='receipt'?object(envelope.receipt):envelope;
 if(!data||!matchesQuote(data.batch,target)||data.batch.status!=='ACCEPTED'||!Array.isArray(data.receipts)||data.receipts.length!==selection(target).numbers.length)return null;
 const payment=object(data.payment),wallet=object(data.wallet),expected=selection(target);
 if(!payment||payment.method!=='wallet'||payment.gateway!=='INTERNAL_WALLET'||!amount(payment.total)||etbToCents(payment.total as string)!==etbToCents(expected.total)||etbToCents(data.batch.total)!==etbToCents(expected.total)||!Array.isArray(payment.acceptedBidIds)||!wallet||!amount(wallet.available)||!amount(wallet.held))return null;
 const ids:string[]=[];
 for(let index=0;index<data.receipts.length;index++){
  const bid=object(object(data.receipts[index])?.bid);
  if(!bid||typeof bid.id!=='string'||!bid.id||bid.auctionSlug!==expected.slug||typeof bid.amount!=='string'||normalizeBidDraft(bid.amount)!==normalizeBidDraft(expected.numbers[index]))return null;
  ids.push(bid.id);
 }
 if(new Set(ids).size!==ids.length||payment.acceptedBidIds.length!==ids.length||payment.acceptedBidIds.some(id=>typeof id!=='string'||!ids.includes(id))||new Set(payment.acceptedBidIds).size!==ids.length)return null;
 return data as unknown as BidBatchReceipt;
}
export function walletBidDefinitiveRejection(error:unknown){return error instanceof ChapaClientError&&error.status>=400&&error.status<500&&![408,429].includes(error.status)}
export class WalletBidCommandUnconfirmedError extends ChapaClientError{
 constructor(readonly statusReads:number){super('The wallet payment is not confirmed yet. Check the original payment.',0,'WALLET_PAYMENT_UNCONFIRMED')}
}
function readUrl(target:WalletBidTarget){return 'command'in target?`${receiptPath}?key=${encodeURIComponent(target.command.key)}`:`/api/payments/chapa/batches/${encodeURIComponent(target.quote.id)}/wallet?quoteHash=${encodeURIComponent(target.quote.quoteHash)}`}
async function observe(target:WalletBidTarget,options:WalletBidCommandOptions,signal:AbortSignal):Promise<BidBatchReceipt>{
 const now=options.now??Date.now,deadline=now()+(options.recoveryWindowMs??20000),maximum=options.maxStatusReads??10,send=options.request??request,pause=options.wait??wait;let reads=0;
 while(reads<maximum&&now()<deadline){
  current(options,signal);let pollAfter=0;
  try{
   const data=await send(readUrl(target),{method:'GET'},signal,Math.max(1,Math.min(5000,deadline-now())));reads++;current(options,signal);
   const receipt=walletBidCommittedReceipt(data,target);if(receipt)return receipt;
   const pending=object(data);if(pending?.kind==='pending'&&typeof pending.pollAfterMs==='number'&&Number.isFinite(pending.pollAfterMs)&&pending.pollAfterMs>0)pollAfter=pending.pollAfterMs;
  }catch(error){
   if(signal.aborted||!options.isCurrent())throw interrupted();
   reads++;
   // A receipt read cannot establish that the original debit failed. Stop
   // on denied ownership/authentication, preserving the original operation.
   if(error instanceof ChapaClientError&&[401,403,409].includes(error.status))break;
  }
  if(reads>=maximum||now()>=deadline)break;
  const delay=Math.max(pollAfter,Math.min(3000,500*2**Math.min(reads,3)));
  await pause(Math.min(delay,Math.max(0,deadline-now())),signal);
 }
 throw new WalletBidCommandUnconfirmedError(reads);
}

/** Read-only restoration: never initializes a second debit or quote. */
export async function recoverWalletBidCommand(target:WalletBidTarget,options:WalletBidCommandOptions):Promise<WalletBidCommandResult>{
 const controller=new AbortController(),abort=()=>controller.abort();if(options.signal?.aborted)controller.abort();else options.signal?.addEventListener('abort',abort,{once:true});
 try{return {kind:'receipt',receipt:await observe(target,options,controller.signal)}}finally{options.signal?.removeEventListener('abort',abort);controller.abort()}
}

/** Exactly one original mutation. Fast responses incur no extra requests.
 * A slow/lost response is observed through the owned receipt endpoint only.
 * The original request timeout is unchanged; an observer budget cannot turn
 * an outstanding original HTTP request into a false terminal outcome. */
export function submitWalletBidCommand(target:WalletBidTarget,options:WalletBidCommandOptions):Promise<WalletBidCommandResult>{
 const controller=new AbortController(),send=options.request??request;
 return new Promise((resolve,reject)=>{
  let done=false,postFinished=false,observerStarted=false,observerError:unknown=null;
  const abort=()=>finish(undefined,interrupted());
  const finish=(result?:WalletBidCommandResult,error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.abort();error?reject(error):resolve(result!)};
  const startObserver=()=>{if(done||observerStarted)return;observerStarted=true;clearTimeout(timer);void observe(target,options,controller.signal).then(receipt=>finish({kind:'receipt',receipt}),error=>{observerError=error;if(postFinished||controller.signal.aborted||!options.isCurrent())finish(undefined,error)})};
  const timer=setTimeout(startObserver,options.probeAfterMs??2000);
  if(options.signal?.aborted){abort();return}options.signal?.addEventListener('abort',abort,{once:true});
  try{current(options,controller.signal)}catch(error){finish(undefined,error);return}
  const url='command'in target?receiptPath:`/api/payments/chapa/batches/${encodeURIComponent(target.quote.id)}/wallet`,body='command'in target?target.command:{quoteHash:target.quote.quoteHash};
  void send(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},controller.signal,15000).then(data=>{
   postFinished=true;if(done)return;current(options,controller.signal);
   const receipt=walletBidCommittedReceipt(data,target);if(receipt){finish({kind:'receipt',receipt});return}
   const response=object(data);if(response?.kind==='quote'&&matchesQuote(response.quote,target)){finish({kind:'quote',quote:response.quote});return}
   if(observerError){finish(undefined,observerError);return}startObserver();
  }).catch(error=>{
   postFinished=true;if(done)return;
   if(controller.signal.aborted||!options.isCurrent()||walletBidDefinitiveRejection(error)){finish(undefined,error);return}
   if(observerError){finish(undefined,observerError);return}startObserver();
  });
 });
}

const recoveryKey=(identity:string,slug:string)=>['lowin-private',identity,'wallet-bid-command',slug] as const;
/** Retain the immutable original key before dispatch, including when its first
 * reply is lost before a batch ID exists. Account logout clears this namespace. */
export function retainWalletBidCommand(client:QueryClient,identity:string,command:WalletBidCommand){const queryKey=recoveryKey(identity,command.auctionSlug);client.getQueryCache().build(client,{queryKey,gcTime:Infinity});client.setQueryData(queryKey,structuredClone(command))}
export function readWalletBidCommand(client:QueryClient,identity:string,slug:string){return client.getQueryData<WalletBidCommand>(recoveryKey(identity,slug))??null}
export function clearWalletBidCommand(client:QueryClient,identity:string,command:WalletBidCommand){if(readWalletBidCommand(client,identity,command.auctionSlug)?.key===command.key)client.removeQueries({queryKey:recoveryKey(identity,command.auctionSlug),exact:true})}
