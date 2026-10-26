import {describe,expect,it} from 'vitest';
import {prepareReset} from '../scripts/prepare-auction-reset';

const acknowledgements={rolloutAcknowledgement:'MATCHING_WEB_AND_WORKERS_DEPLOYED',backupAcknowledgement:'RESTORABLE_BACKUP_VERIFIED',executionAcknowledgement:'EXECUTE_REVIEWED_RESET'};
const schema={schemaHash:'synthetic-schema',columns:[],migrations:[],functions:[],triggers:[],constraints:[]};
const recovery={credits:[],publicResults:[]};
function inventory(fee='10'){
 return {
  identity:{read_only:'on',verifiedTls:false,snapshot_at:'2026-10-26T10:00:00.000Z',projectRef:'isolated-fixture'},schemaHash:schema.schemaHash,snapshotHash:'synthetic-snapshot',
  drift:[],unbalanced:[],heldDrift:[],staffFingerprint:[{userId:'owner',role:'OWNER',active:true,enrolled:true,protected_mfa_fingerprint:'synthetic-mfa',credential_fingerprint:'synthetic-credential'}],users:[{count:2,identity_fingerprint:'synthetic-users'}],
  auctions:[{id:'auction',code:1,status:'LIVE',publishedAt:'2026-10-25T10:00:00.000Z',slug:'synthetic-auction',controlVersion:1,acceptedBidCount:1,bidSequence:1,endsAt:'2026-10-30T10:00:00.000Z',productId:'product',categoryId:'category',terms:{ruleVersion:'lowest-unique-v4',version:1,entryFeePoints:fee}}],
  bids:[{id:'bid',auctionId:'auction',userId:'bidder',operationId:'bid-operation',amount:'3.60',feePoints:fee,actual_fee_credit:fee,actual_user_debit:fee,journal_id:'bid-journal',termsVersion:1,acceptanceOrder:1,acceptedAt:'2026-10-26T09:00:00.000Z'}],
  wallets:[{id:'wallet',userId:'bidder',available:'90',held:'0'}],accounts:[{id:'available',name:'user:bidder:available',kind:'AVAILABLE',walletId:'wallet',balance:'90'},{id:'held',name:'user:bidder:held',kind:'HELD',walletId:'wallet',balance:'0'},{id:'fees',name:'platform:fees',kind:'FEES',walletId:null,balance:fee}],
  operations:[{id:'bid-operation',userId:'bidder',scope:'BID',result:{auctionId:'auction'}}],journals:[{id:'bid-journal',operationId:'bid-operation'}],postings:[{journalId:'bid-journal',accountId:'available',delta:`-${fee}`},{journalId:'bid-journal',accountId:'fees',delta:fee}],holds:[],settlements:[],claims:[],payments:[],dependencies:[{id:'product',categoryId:'category'}],categories:[{id:'category'}],
 };
}
function prepare(data=inventory(),review?:Record<string,unknown>,runId='review-unit-reset'){
 return prepareReset(data,schema,recovery,{runId,reason:'Synthetic review binding verification',fixture:true,review});
}
function approve(config:Record<string,any>){return {...acknowledgements,reviewedManifestHash:config.manifestHash,reviewedCompensationEtb:config.totalCompensation}}

describe('offline auction reset approval binds the exact reviewed snapshot',()=>{
 it('leaves an unreviewed or explicitly blocked preview non-executable',()=>{
  for(const review of [undefined,{rolloutAcknowledgement:'REVIEW_REQUIRED',backupAcknowledgement:'REVIEW_REQUIRED',executionAcknowledgement:'REVIEW_REQUIRED'}]){
   const {config}=prepare(inventory(),review);
   expect([config.rolloutAcknowledgement,config.backupAcknowledgement,config.executionAcknowledgement]).toEqual(['REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED']);
  }
 });
 it.each(Object.keys(acknowledgements))('rejects an unbound %s approval even when other gates remain blocked',key=>{
  expect(()=>prepare(inventory(),{[key]:acknowledgements[key as keyof typeof acknowledgements]})).toThrow('Reviewed manifest is missing or changed');
 });
 it('accepts freshly reviewed hash and exact cents without changing the monetary manifest',()=>{
  const preview=prepare(),ready=prepare(inventory(),{...approve(preview.config),reviewedCompensationEtb:'10.00'});
  expect(ready.config.manifestHash).toBe(preview.config.manifestHash);expect(ready.config.totalCompensation).toBe('10');expect(ready.config.executionAcknowledgement).toBe('EXECUTE_REVIEWED_RESET');
 });
 it('rejects the old approval when accepted fees change and requires a new amount even with a new hash',()=>{
  const old=approve(prepare().config),updated=inventory('15'),preview=prepare(updated);
  expect(()=>prepare(updated,old)).toThrow('Reviewed manifest is missing or changed');
  expect(()=>prepare(updated,{...old,reviewedManifestHash:preview.config.manifestHash})).toThrow('Reviewed compensation is missing or differs');
  expect(prepare(updated,approve(preview.config)).summary.totalCompensation).toBe('15.00');
 });
 it('rejects a later audit snapshot even when the total has not changed',()=>{
  const old=approve(prepare().config),updated=inventory();updated.identity.snapshot_at='2026-10-26T10:01:00.000Z';
  expect(()=>prepare(updated,old)).toThrow('Reviewed manifest is missing or changed');
 });
 it('binds source bids, frozen controls and run identity, not just the aggregate amount',()=>{
  const old=approve(prepare().config),changedBid=inventory(),changedControl=inventory();changedBid.bids[0].amount='4.60';changedControl.auctions[0].controlVersion=2;
  for(const changed of [changedBid,changedControl])expect(()=>prepare(changed,old)).toThrow('Reviewed manifest is missing or changed');
  expect(()=>prepare(inventory(),old,'different-reviewed-run')).toThrow('Reviewed manifest is missing or changed');
 });
 it.each([undefined,'10.001','1e1','NaN','-10',10])('rejects missing, inexact or non-string compensation %s',reviewedCompensationEtb=>{
  const preview=prepare();expect(()=>prepare(inventory(),{...approve(preview.config),reviewedCompensationEtb})).toThrow('Reviewed compensation is missing or differs');
 });
});
