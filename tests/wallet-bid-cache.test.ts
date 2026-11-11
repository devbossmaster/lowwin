import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {BidBatchReceipt} from '../src/lib/bid-batch-client';
import type {BidSheetAuction} from '../src/components/bid-sheet-preview';
import type {PersonalBidList,PersonalBidListItem} from '../src/modules/profile/bid-list';
import {publishWalletBidReceipt} from '../src/components/wallet-bid-cache';
import {myBidsQueryUrl} from '../src/components/my-bids-list-copy';
import {loadPrivateJson,readPrivateQuery,seedPrivateQuery,setPrivateQueryIdentity} from '../src/components/private-query-cache';

const owner='wallet-owner:session';
const auction={slug:'power-bank',code:'51',status:'live',startsAt:'2026-11-10T09:00:00.000Z',endsAt:'2026-11-14T09:00:00.000Z',isDemo:false,bidCount:1,product:{title:'Power bank',titleAm:'ፓወር ባንክ',images:[{path:'/catalog/power-bank.webp',alt:'Power bank banner'}]},terms:{version:1,ruleVersion:'lowest-unique-v4',entryFeePoints:'10.00'}} satisfies BidSheetAuction;
const oldRow:PersonalBidListItem={id:'existing-bid',amount:'2.00',acceptedAt:'2026-11-12T08:59:00.000Z',outcome:'LIVE',auction:{ruleVersion:'lowest-unique-v4',code:'51',slug:'power-bank',status:'LIVE',title:'Power bank',titleAm:'ፓወር ባንክ',image:{path:'/catalog/power-bank.webp',alt:'Power bank banner'},startsAt:auction.startsAt,endsAt:auction.endsAt,isDemo:false}};
function page(items:PersonalBidListItem[]=[oldRow],pageNumber=1,pageSize=20):PersonalBidList{return {items,page:pageNumber,pageSize,hasNext:false,serverNow:'2026-11-12T09:00:00.000Z'}}
function receipt({revision='2',available='70.00',id='new-bid',amount='4.25',acceptedAt='2026-11-12T09:01:00.000Z'}={}){
 return {batch:{id:'batch-one',quoteHash:'a'.repeat(64),auctionSlug:'power-bank',feeVersion:1,ruleVersion:'lowest-unique-v4',lines:[{position:0,number:amount,grossFee:'10.00',discount:'0.00',netFee:'10.00'}],entryCount:1,total:'10.00',totalCents:'1000',grossTotal:'10.00',discountTotal:'0.00',status:'ACCEPTED'},receipts:[{bid:{id,auctionCode:'51',auctionSlug:'power-bank',amount,acceptedAt,termsVersion:1,feePoints:'10.00'},charge:{feePoints:'10.00',newlyUnavailable:'10.00'}}],wallet:{available,held:'0.00',revision}} satisfies BidBatchReceipt&{wallet:{available:string;held:string;revision:string}};
}
function wallet(value:Record<string,unknown>={}){return {available:'80.00',held:'0.00',currency:'ETB',revision:'1',topUp:{enabled:false,reason:'NOT_CONFIGURED'},...value}}
function cachedWallet(){return readPrivateQuery<Record<string,unknown>>(owner,'/api/wallet')}
function cachedLive(language='en',pageNumber=1){return readPrivateQuery<PersonalBidList>(owner,myBidsQueryUrl('live',pageNumber,language))}

beforeEach(()=>{vi.stubGlobal('window',{});vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-12T09:01:02.000Z'));setPrivateQueryIdentity(owner)});
afterEach(()=>{setPrivateQueryIdentity(null);vi.useRealTimers();vi.unstubAllGlobals()});

describe('committed wallet bid display cache',()=>{
 it('publishes the committed balance and accepted IDs into both cached Live languages, preserving metadata',()=>{
  seedPrivateQuery(owner,'/api/wallet',wallet());
  for(const language of ['en','am'])seedPrivateQuery(owner,myBidsQueryUrl('live',1,language),page());
  const finished=page([{...oldRow,outcome:'LOST'}]);seedPrivateQuery(owner,myBidsQueryUrl('finished',1,'en'),finished);
  publishWalletBidReceipt(owner,receipt(),auction);
  expect(cachedWallet()).toMatchObject({value:{available:'70.00',held:'0.00',revision:'2',currency:'ETB',topUp:{enabled:false,reason:'NOT_CONFIGURED'}},fresh:false});
  for(const language of ['en','am']){
   const list=cachedLive(language)!;expect(list.fresh).toBe(false);expect(list.value.items.map(item=>item.id)).toEqual(['new-bid','existing-bid']);
   expect(list.value.items[0]).toMatchObject({amount:'4.25',acceptedAt:'2026-11-12T09:01:00.000Z',outcome:'LIVE',auction:{title:'Power bank',titleAm:'ፓወር ባንክ',image:{path:'/catalog/power-bank.webp'}}});
   expect(list.value.serverNow).toBe('2026-11-12T09:01:00.000Z');
  }
  expect(readPrivateQuery<PersonalBidList>(owner,myBidsQueryUrl('finished',1,'en'))?.value).toEqual(finished);
 });
 it('never fabricates an uncached wallet, first page, or pagination data',()=>{
  const second=page([oldRow],2);seedPrivateQuery(owner,myBidsQueryUrl('live',2,'en'),second);
  publishWalletBidReceipt(owner,receipt(),auction);
  expect(cachedWallet()).toBeNull();expect(cachedLive()).toBeNull();expect(cachedLive('am')).toBeNull();expect(cachedLive('en',2)?.value).toEqual(second);
 });
 it('merges stable accepted IDs without duplicate rows on receipt replay',()=>{
  seedPrivateQuery(owner,'/api/wallet',wallet());seedPrivateQuery(owner,myBidsQueryUrl('live',1,'en'),page());
  publishWalletBidReceipt(owner,receipt(),auction);publishWalletBidReceipt(owner,receipt(),auction);
  expect(cachedLive()?.value.items.map(item=>item.id)).toEqual(['new-bid','existing-bid']);
 });
 it('keeps a bounded first page and marks known overflow rather than guessing missing records',()=>{
  seedPrivateQuery(owner,myBidsQueryUrl('live',1,'en'),page([oldRow],1,1));publishWalletBidReceipt(owner,receipt(),auction);
  expect(cachedLive()?.value).toMatchObject({page:1,pageSize:1,hasNext:true,items:[{id:'new-bid'}]});expect(cachedLive('en',2)).toBeNull();
 });
 it('cannot publish a previous account receipt into the current account',()=>{
  setPrivateQueryIdentity('other:session');seedPrivateQuery('other:session','/api/wallet',wallet({available:'5.00'}));
  publishWalletBidReceipt(owner,receipt(),auction);
  expect(readPrivateQuery('other:session','/api/wallet')?.value).toMatchObject({available:'5.00'});expect(cachedLive()).toBeNull();
 });
 it('does not regress a newer wallet revision when concurrent responses arrive out of order',()=>{
  seedPrivateQuery(owner,'/api/wallet',wallet());
  publishWalletBidReceipt(owner,receipt({revision:'5',available:'40.00',id:'fifth'}),auction);
  publishWalletBidReceipt(owner,receipt({revision:'4',available:'50.00',id:'fourth',acceptedAt:'2026-11-12T09:00:30.000Z'}),auction);
  expect(cachedWallet()?.value).toMatchObject({available:'40.00',revision:'5'});
  publishWalletBidReceipt(owner,receipt({revision:'6',available:'35.00',id:'fourth',acceptedAt:'2026-11-12T09:00:30.000Z'}),auction);
  expect(cachedWallet()?.value).toMatchObject({available:'35.00',revision:'6'});
 });
 it('does not invent a version or overwrite a versioned balance with a legacy unversioned receipt',()=>{
  seedPrivateQuery(owner,'/api/wallet',wallet({revision:'5',available:'40.00'}));
  const legacy=receipt();delete (legacy.wallet as {revision?:string}).revision;publishWalletBidReceipt(owner,legacy,auction);
  expect(cachedWallet()?.value).toMatchObject({available:'40.00',revision:'5'});
  seedPrivateQuery(owner,'/api/wallet',{available:'80.00',held:'0.00',currency:'ETB',topUp:{enabled:false}});publishWalletBidReceipt(owner,legacy,auction);
  expect(cachedWallet()?.value).toMatchObject({available:'70.00'});expect(cachedWallet()?.value).not.toHaveProperty('revision');
 });
 it('never labels a receipt as Live after a known public deadline or while the auction is closed',()=>{
  seedPrivateQuery(owner,'/api/wallet',wallet());seedPrivateQuery(owner,myBidsQueryUrl('live',1,'en'),page());
  publishWalletBidReceipt(owner,receipt(),{...auction,status:'closed'});expect(cachedLive()?.value.items).toEqual([oldRow]);
  publishWalletBidReceipt(owner,receipt(),{...auction,endsAt:'2026-11-12T09:00:00.000Z'});expect(cachedLive()?.value.items).toEqual([oldRow]);
  expect(cachedWallet()?.value).toMatchObject({available:'70.00'});
 });
 it('cancels an obsolete wallet read before it can replace the committed receipt balance',async()=>{
  seedPrivateQuery(owner,'/api/wallet',wallet());let complete!:(value:Response)=>void,signal!:AbortSignal;
  vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>{signal=options.signal!;return new Promise<Response>(resolve=>{complete=resolve})}));
  const old=loadPrivateJson(owner,'/api/wallet',{force:true}),rejected=expect(old).rejects.toBeDefined();
  publishWalletBidReceipt(owner,receipt(),auction);expect(signal.aborted).toBe(true);complete(Response.json(wallet()));await rejected;
  expect(cachedWallet()?.value).toMatchObject({available:'70.00',revision:'2'});
 });
 it('does not publish a quote or a receipt for another auction',()=>{
  seedPrivateQuery(owner,'/api/wallet',wallet());const pending=receipt();pending.batch.status='QUOTED';
  publishWalletBidReceipt(owner,pending,auction);publishWalletBidReceipt(owner,receipt(),{...auction,slug:'other-auction'});
  expect(cachedWallet()?.value).toMatchObject({available:'80.00',revision:'1'});
 });
});
