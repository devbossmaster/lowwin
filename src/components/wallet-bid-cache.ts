'use client';
import type {BidBatchReceipt} from '@/lib/bid-batch-client';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {PersonalBidList,PersonalBidListItem} from '@/modules/profile/bid-list';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {BidSheetAuction} from './bid-sheet-preview';
import {myBidsQueryUrl} from './my-bids-list-copy';
import {confirmedBidQueryScopes,invalidatePrivateQueries,isPrivateQueryIdentity,readPrivateQuery,seedPrivateQuery} from './private-query-cache';

type RevisionedWallet={revision?:string};
function revision(value:string|undefined){try{return value&&/^\d+$/.test(value)?BigInt(value):null}catch{return null}}

function acceptedTime(receipt:BidBatchReceipt){
 let latest=-Infinity;
 for(const {bid} of receipt.receipts){const at=Date.parse(bid.acceptedAt);if(!bid.id||!Number.isFinite(at))return null;latest=Math.max(latest,at)}
 return Number.isFinite(latest)?latest:null;
}

/** Publishes committed server receipts into existing display snapshots only.
 * This never submits, credits, predicts an outcome, or fabricates a missing page.
 * The normal scoped refresh then reconciles the rest of the account projection.
 */
export function publishWalletBidReceipt(identity:string,receipt:BidBatchReceipt,auction:BidSheetAuction){
 if(!isPrivateQueryIdentity(identity)||receipt.batch.status!=='ACCEPTED'||receipt.batch.auctionSlug!==auction.slug||!receipt.receipts.length||receipt.receipts.some(({bid})=>bid.auctionSlug!==auction.slug||bid.auctionCode!==auction.code))return;
 const latestAccepted=acceptedTime(receipt);if(latestAccepted===null)return;
 const wallet=receipt.wallet as (NonNullable<BidBatchReceipt['wallet']>&RevisionedWallet)|undefined;
 if(wallet){
  const previous=readPrivateQuery<WalletBalance&RevisionedWallet>(identity,'/api/wallet'),incoming=revision(wallet.revision),current=revision(previous?.value.revision);
  // The real per-wallet database revision orders concurrent responses. Legacy
  // unversioned snapshots may be seeded only before a revision is known.
  if(previous&&(incoming!==null?(current===null||incoming>=current):current===null)){
   try{
    const available=centsToEtb(etbToCents(wallet.available)),held=centsToEtb(etbToCents(wallet.held));
    seedPrivateQuery(identity,'/api/wallet',{...previous.value,available,held,...(incoming!==null?{revision:wallet.revision}:{})});
   }catch{/* Invalid display data cannot replace a known wallet projection. */}
  }
 }
 if(auction.status==='live')for(const language of ['en','am'] as const){
  if(!isPrivateQueryIdentity(identity))return;
  const url=myBidsQueryUrl('live',1,language),cached=readPrivateQuery<PersonalBidList>(identity,url);
  if(!cached||cached.value.page!==1||!Number.isSafeInteger(cached.value.pageSize)||cached.value.pageSize<1)continue;
  const old=cached.value,knownTime=Date.parse(old.serverNow),endsAt=Date.parse(auction.endsAt);
  // A passed public deadline cannot turn a historical receipt into a Live row.
  if(!Number.isFinite(knownTime)||!Number.isFinite(endsAt)||endsAt<=Math.max(knownTime,latestAccepted))continue;
  const seen=new Set(old.items.map(item=>item.id)),image=auction.product.images[0];
  const additions:PersonalBidListItem[]=receipt.receipts.filter(({bid})=>!seen.has(bid.id)).map(({bid})=>({
   id:bid.id,amount:bid.amount,acceptedAt:bid.acceptedAt,outcome:'LIVE',
   auction:{ruleVersion:receipt.batch.ruleVersion,code:bid.auctionCode,slug:bid.auctionSlug,status:'LIVE',title:auction.product.title,titleAm:auction.product.titleAm??null,image:image?{path:image.path,alt:image.alt}:null,startsAt:auction.startsAt,endsAt:auction.endsAt,isDemo:auction.isDemo},
  }));
  if(!additions.length)continue;
  const merged=[...additions,...old.items].sort((a,b)=>Date.parse(b.acceptedAt)-Date.parse(a.acceptedAt)||b.id.localeCompare(a.id));
  const unique=[...new Map(merged.map(item=>[item.id,item])).values()],newAnchor=latestAccepted>knownTime;
  seedPrivateQuery(identity,url,{...old,items:unique.slice(0,old.pageSize),hasNext:old.hasNext||unique.length>old.pageSize,serverNow:newAnchor?new Date(latestAccepted).toISOString():old.serverNow},newAnchor?Date.now():cached.updatedAt);
 }
 if(isPrivateQueryIdentity(identity))invalidatePrivateQueries(identity,confirmedBidQueryScopes(auction.slug));
}
