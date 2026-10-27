/** Offline SQL preparation only. This command has no database write capability.
 * Customer-specific manifests must stay in an ignored/private output directory. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {etbToCents,centsToEtb} from '../src/lib/money';
type Row=Record<string,any>;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=(key:string)=>{const h=hash(key);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const money=(v:unknown)=>etbToCents(String(v));
const numeric=(v:bigint)=>centsToEtb(v).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');
// Encoding avoids quote, backslash, dollar-delimiter and replacement-token
// collisions in frozen terms / constraint definitions. It is not encryption.
const sqlJson=(v:unknown)=>`convert_from(decode('${Buffer.from(JSON.stringify(v),'utf8').toString('base64')}','base64'),'UTF8')::jsonb`;
function ensure(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message)}
function sum(rows:Row[],field:string){return rows.reduce((n,r)=>n+money(r[field]??'0'),0n)}
export function prepareReset(data:Row,schema:Row,recovery:Row,options:{runId:string;reason:string;fixture?:boolean;review?:Row}){
 ensure(data.identity?.read_only==='on','Input must come from an explicitly read-only audit');
 ensure(options.fixture||data.identity?.verifiedTls===true,'Production inventory requires verified TLS');
 ensure(schema.schemaHash===data.schemaHash,'Schema and financial audit do not match');
 ensure(/^[a-z0-9][a-z0-9-]{7,70}$/.test(options.runId),'Use a unique, stable run identity');
 ensure(options.reason.length>=12&&options.reason.length<=500,'Write a meaningful audited reset reason');
 for(const key of ['drift','unbalanced','heldDrift'])ensure(Array.isArray(data[key])&&data[key].length===0,`Stop on ${key}`);
 const owners=data.staffFingerprint.filter((s:Row)=>s.role==='OWNER'&&s.active&&s.enrolled);ensure(owners.length===1,'Exactly one explicitly identified active Owner is required');const owner=owners[0];
 const settled=new Set(data.settlements.map((s:Row)=>s.auctionId)),illustrative=new Set((recovery.publicResults??[]).map((s:Row)=>s.auctionId));
 const targets=data.auctions.filter((a:Row)=>a.publishedAt&&['LIVE','SCHEDULED'].includes(a.status)&&!settled.has(a.id)&&!illustrative.has(a.id));ensure(targets.length>0,'No unsettled published targets; do not reuse an old package');
 const targetIds=new Set(targets.map((a:Row)=>a.id)),blockingExceptions:string[]=[];
 const accountById=new Map<string,Row>(data.accounts.map((a:Row)=>[a.id,a])),opById=new Map<string,Row>(data.operations.map((o:Row)=>[o.id,o])),journalByOp=new Map<string,Row>(data.journals.map((j:Row)=>[j.operationId,j]));
 const walletByUser=new Map<string,Row>(data.wallets.map((w:Row)=>[w.userId,w]));
 const postings=(op:Row)=>data.postings.filter((p:Row)=>p.journalId===journalByOp.get(op.id)?.id);
 function adjustment(userId:string,auctionId:string,scopes:string[]){return data.operations.filter((o:Row)=>o.userId===userId&&o.result?.auctionId===auctionId&&scopes.includes(o.scope)).reduce((total:bigint,o:Row)=>{const rows=postings(o),credit=rows.filter((p:Row)=>accountById.get(p.accountId)?.name===`user:${userId}:available`),debit=rows.filter((p:Row)=>accountById.get(p.accountId)?.name==='platform:fees');ensure(rows.length===2&&sum(credit,'delta')===-sum(debit,'delta'),'Ambiguous discount/refund journal; stop');return total+sum(credit,'delta')},0n)}
 const participants:Row[]=[];
 for(const a of targets){
  ensure(a.terms&&['lowest-unique-v1','lowest-unique-v2','lowest-unique-v3','lowest-unique-v4'].includes(a.terms.ruleVersion),'Unsupported frozen rule version');
  const bids=data.bids.filter((b:Row)=>b.auctionId===a.id);ensure(bids.length===a.acceptedBidCount,'Accepted-count drift');
  const users=[...new Set<string>([...bids.map((b:Row)=>b.userId),...data.holds.filter((h:Row)=>h.auctionId===a.id).map((h:Row)=>h.userId)])].sort();
  for(const userId of users){const own=bids.filter((b:Row)=>b.userId===userId),wallet=walletByUser.get(userId);ensure(wallet,'Missing participant wallet');const hold=data.holds.find((h:Row)=>h.walletId===wallet.id&&h.auctionId===a.id),gross=sum(own,'feePoints'),discount=adjustment(userId,a.id,['REFERRAL_DISCOUNT']),prior=adjustment(userId,a.id,['AUCTION_FEE_REFUND','AUCTION_RESET_COMPENSATION']);
   for(const b of own){const op=opById.get(b.operationId);ensure(op?.scope==='BID'&&op.userId===userId,'Bid operation ownership mismatch');ensure(money(b.actual_fee_credit)===money(b.feePoints)&&money(b.actual_user_debit)===money(b.feePoints),'Fee debit differs from disclosed accepted fee');ensure(new Date(b.acceptedAt)<new Date(a.endsAt),'A source bid is outside the frozen cutoff')}
   ensure(gross-discount-prior>=0n,'Prior adjustments exceed actual net fees');
   if(a.terms.ruleVersion!=='lowest-unique-v4'&&(discount>0n||prior>0n))blockingExceptions.push(`Legacy target ${a.id} needs specific review: canonical cancellation requires gross fee refunds`);
   const stem=`${options.runId}:${a.id}:${userId}`;
   participants.push({auctionId:a.id,userId,walletId:wallet.id,bidIds:own.map((b:Row)=>b.id).sort(),feeJournalIds:own.map((b:Row)=>b.journal_id).filter(Boolean).sort(),grossFee:numeric(gross),discount:numeric(discount),priorRefund:numeric(prior),compensation:numeric(gross-discount-prior),holdId:hold?.id??null,holdRelease:numeric(money(hold?.points??'0')),availableBefore:wallet.available,heldBefore:wallet.held,movementId:uuid(stem+':movement'),releaseOperationId:uuid(stem+':release'),releaseJournalId:uuid(stem+':release-journal'),compensationOperationId:uuid(stem+':compensation'),compensationJournalId:uuid(stem+':compensation-journal')});
  }
 }
 for(const o of data.operations.filter((o:Row)=>o.scope==='ADMIN_CREDIT'))ensure(recovery.credits?.some((r:Row)=>r.operationId===o.id&&r.sourceIntentId&&r.intentId===o.result?.intentId),'Unattributed historical admin credit: explicit review required');
 const total=sum(participants,'compensation'),releases=sum(participants,'holdRelease'),walletExpected=data.accounts.map((a:Row)=>{let delta=0n;if(a.name==='platform:fees')delta=-total;else if(a.walletId){const own=participants.filter(p=>p.walletId===a.walletId);delta=a.kind==='AVAILABLE'?sum(own,'compensation')+sum(own,'holdRelease'):a.kind==='HELD'?-sum(own,'holdRelease'):0n}return {id:a.id,balance:numeric(money(a.balance)+delta)}});
 const walletSummary=[...new Set<string>(participants.map(p=>p.walletId))].sort().map(walletId=>{const own=participants.filter(p=>p.walletId===walletId),first=own[0],compensation=sum(own,'compensation'),holdRelease=sum(own,'holdRelease');return {userId:first.userId,walletId,compensation:numeric(compensation),holdRelease:numeric(holdRelease),availableBefore:first.availableBefore,heldBefore:first.heldBefore,availableAfterRun:numeric(money(first.availableBefore)+compensation+holdRelease),heldAfterRun:numeric(money(first.heldBefore)-holdRelease)}});
 for(const participant of participants){const expected=walletSummary.find(w=>w.walletId===participant.walletId)!;participant.availableAfterRun=expected.availableAfterRun;participant.heldAfterRun=expected.heldAfterRun}
 // Settled/illustrative results are excluded from cancellation and retain
 // their catalog visibility even if historical inventory shares a category.
 const protectedProducts=new Set(data.auctions.filter((a:Row)=>settled.has(a.id)||illustrative.has(a.id)).map((a:Row)=>a.productId)),protectedCategories=new Set(data.auctions.filter((a:Row)=>settled.has(a.id)||illustrative.has(a.id)).map((a:Row)=>a.categoryId));
 for(const p of data.dependencies)if(protectedProducts.has(p.id))protectedCategories.add(p.categoryId);
 for(const a of targets)if(protectedProducts.has(a.productId))blockingExceptions.push(`Target ${a.id} shares a product with a finalized result; review archival visibility separately`);
 const config:Row={version:1,runId:options.runId,reason:options.reason,snapshotAt:data.identity.snapshot_at,snapshotHash:data.snapshotHash,schemaHash:schema.schemaHash,projectRef:data.identity.projectRef??'isolated-fixture',ownerId:owner.userId,ownerMfaFingerprint:owner.protected_mfa_fingerprint,ownerCredentialFingerprint:owner.credential_fingerprint,claimCount:data.claims.length,intentCount:data.payments.length,userCount:data.users[0].count,userFingerprint:data.users[0].identity_fingerprint,
  columns:schema.columns,migrations:schema.migrations.filter((m:Row)=>m.finished_at&&!m.rolled_back_at).map((m:Row)=>({name:m.migration_name,checksum:m.checksum})),functions:schema.functions.map((f:Row)=>({name:f.name,arguments:f.arguments,hash:hash(f.definition)})),triggers:schema.triggers.map((t:Row)=>({table:t.table_name,name:t.name,enabled:t.enabled,hash:hash(t.definition)})),constraints:schema.constraints.map((c:Row)=>({table:c.table_name,name:c.name,definition:c.definition,validated:c.validated})),
  auctions:targets.map((a:Row)=>({id:a.id,code:a.code,status:a.status,slug:a.slug,controlVersion:a.controlVersion,acceptedBidCount:a.acceptedBidCount,bidSequence:a.bidSequence,endsAt:new Date(a.endsAt).toISOString(),terms:a.terms,settlementId:uuid(options.runId+':settlement:'+a.id),cancelKey:uuid(options.runId+':cancel:'+a.id),cancelRequestHash:hash(JSON.stringify({auctionId:a.id,actorId:owner.userId,reason:options.reason})),controlRevisionId:uuid(options.runId+':unpublish:'+a.id),bids:data.bids.filter((b:Row)=>b.auctionId===a.id).map((b:Row)=>({id:b.id,userId:b.userId,operationId:b.operationId,amount:numeric(money(b.amount)),feePoints:numeric(money(b.feePoints)),termsVersion:b.termsVersion,acceptanceOrder:b.acceptanceOrder===null?null:String(b.acceptanceOrder),acceptedAt:new Date(b.acceptedAt).toISOString()})).sort((a:Row,b:Row)=>a.id.localeCompare(b.id))})),
  participants,walletSummary,walletBaseline:data.accounts.map((a:Row)=>({id:a.id,name:a.name,balance:a.balance})),walletExpected,products:data.dependencies.filter((p:Row)=>!protectedProducts.has(p.id)).map((p:Row)=>({id:p.id})),categories:data.categories.filter((c:Row)=>!protectedCategories.has(c.id)).map((c:Row)=>({id:c.id})),totalCompensation:numeric(total),totalHoldReleases:numeric(releases),blockingExceptions,
  exceptions:{settledAuctions:data.settlements.map((s:Row)=>({auctionId:s.auctionId,outcome:s.outcome})),unresolvedPayments:data.payments.filter((p:Row)=>['PENDING','VERIFYING','SUBMITTING','NEEDS_REVIEW','PROVIDER_OUTAGE','DUPLICATE_CONFLICT'].includes(p.status)).map((p:Row)=>({id:p.id,userId:p.userId,status:p.status,reason:p.reasonCode,caseState:p.caseState})),historicalAdminCredits:recovery.credits??[]},
 };
 config.manifestHash=hash(JSON.stringify(config));
 const acknowledgementKeys=['rolloutAcknowledgement','backupAcknowledgement','executionAcknowledgement'],review=options.review;
 // Approval belongs to this exact snapshot. A review file from an earlier
 // audit must not silently authorize a regenerated target list or amount.
 if(review&&acknowledgementKeys.some(key=>review[key]!==undefined&&review[key]!=='REVIEW_REQUIRED')){
  ensure(review.reviewedManifestHash===config.manifestHash,'Reviewed manifest is missing or changed: review the new hash and compensation before approval');
  let reviewedCents:bigint|null=null;try{if(typeof review.reviewedCompensationEtb==='string')reviewedCents=money(review.reviewedCompensationEtb)}catch{}
  ensure(reviewedCents===total,'Reviewed compensation is missing or differs from the exact net fee total');
 }
 for(const key of acknowledgementKeys)config[key]=review?.[key]??'REVIEW_REQUIRED';
 ensure(config.runId===options.runId,'Review configuration cannot change the run');
 return {config,summary:{auctions:targets.length,acceptedBids:data.bids.filter((b:Row)=>targetIds.has(b.auctionId)).length,distinctBidders:new Set(participants.map(p=>p.userId)).size,totalCompensation:centsToEtb(total),holdRelease:centsToEtb(releases),blockingExceptions,unresolvedPayments:config.exceptions.unresolvedPayments.filter((p:Row)=>!['RESOLVED','ARCHIVED'].includes(p.caseState)).length,resolvedReviewStatuses:config.exceptions.unresolvedPayments.filter((p:Row)=>['RESOLVED','ARCHIVED'].includes(p.caseState)).length}};
}
export function writeResetPackage(config:Row,output:string){
 fs.mkdirSync(output,{recursive:true});const template=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'sql/auction-reset-execute.sql'),'utf8');fs.writeFileSync(path.join(output,'02_guarded_reset.sql'),`-- Run: ${config.runId}\n-- Snapshot: ${config.snapshotAt}\n-- Manifest SHA256: ${config.manifestHash}\n-- Exact target IDs: ${config.auctions.map((a:Row)=>a.id).join(', ')}\n-- Compensation: ${config.totalCompensation} ETB; hold releases: ${config.totalHoldReleases} ETB\n-- Review the readable review-config.json and refund-manifest.csv alongside this file.\n`+template.replaceAll('__RESET_CONFIG_JSON__',()=>sqlJson(config)));
 fs.writeFileSync(path.join(output,'review-config.json'),JSON.stringify(config,null,2)+'\n');
 const headers=['auctionId','userId','walletId','grossFee','discount','priorRefund','compensation','holdRelease','availableBefore','heldBefore','availableAfterRun','heldAfterRun','bidIds','feeJournalIds'];
 fs.writeFileSync(path.join(output,'refund-manifest.csv'),headers.join(',')+'\n'+config.participants.map((r:Row)=>headers.map(h=>'"'+String(Array.isArray(r[h])?r[h].join('|'):r[h]).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 const walletHeaders=['userId','walletId','compensation','holdRelease','availableBefore','heldBefore','availableAfterRun','heldAfterRun'];
 fs.writeFileSync(path.join(output,'wallet-summary.csv'),walletHeaders.join(',')+'\n'+config.walletSummary.map((r:Row)=>walletHeaders.map(h=>'"'+String(r[h]).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 const ids=config.auctions.map((a:Row)=>"'"+a.id.replaceAll("'","''")+"'").join(',');
 const inventoryTemplate=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'sql/auction-reset-inventory.sql'),'utf8');
 fs.writeFileSync(path.join(output,'01_inventory.sql'),inventoryTemplate.replaceAll('__RESET_TARGET_IDS__',()=>ids).replaceAll('__RESET_COMPLETE_KEY__',()=>"'reset:"+config.runId.replaceAll("'","''")+":complete'"));
 fs.writeFileSync(path.join(output,'03_verify.sql'),`-- Read-only post-run proof. Maintenance remains active until a separate reviewed release.\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT action,target,\"requestHash\",details FROM \"AdminAudit\" WHERE \"operationKey\"='reset:${config.runId}:complete';\nSELECT a.id,a.status,a.slug,s.outcome,s.\"ruleVersion\",s.proof->>'feePolicy' AS original_fee_policy FROM \"Auction\" a LEFT JOIN \"AuctionSettlement\" s ON s.\"auctionId\"=a.id WHERE a.id IN(${ids}) ORDER BY a.id;\nSELECT COUNT(*) AS compensation_operations,COALESCE(SUM(p.delta),0) AS credited_etb FROM \"Operation\" o JOIN \"Journal\" j ON j.\"operationId\"=o.id JOIN \"Posting\" p ON p.\"journalId\"=j.id JOIN \"LedgerAccount\" la ON la.id=p.\"accountId\" WHERE o.result->>'runId'='${config.runId}' AND la.kind='AVAILABLE';\nSELECT la.id,la.balance,COALESCE(SUM(p.delta),0) AS posting_balance FROM \"LedgerAccount\" la LEFT JOIN \"Posting\" p ON p.\"accountId\"=la.id GROUP BY la.id HAVING la.balance<>COALESCE(SUM(p.delta),0);\nSELECT j.id FROM \"Journal\" j LEFT JOIN \"Posting\" p ON p.\"journalId\"=j.id GROUP BY j.id HAVING COUNT(p.id)<2 OR SUM(p.delta)<>0;\nSELECT w.id,la.balance,COALESCE(SUM(h.points),0) AS holds FROM \"Wallet\" w JOIN \"LedgerAccount\" la ON la.\"walletId\"=w.id AND la.kind='HELD' LEFT JOIN \"AuctionHold\" h ON h.\"walletId\"=w.id GROUP BY w.id,la.balance HAVING la.balance<>COALESCE(SUM(h.points),0);\nSELECT COUNT(*) AS remaining_public_auctions FROM \"Auction\" WHERE \"publishedAt\" IS NOT NULL AND status IN('LIVE','SCHEDULED') AND slug IS NOT NULL AND \"testRunId\" IS NULL AND NOT \"isDemo\";\nSELECT COUNT(*) AS registered_users FROM \"user\";\nSELECT \"userId\",role,active,secret IS NOT NULL AS enrolled FROM \"StaffMember\" ORDER BY \"userId\";\nSELECT kind,SUM(balance) FROM \"LedgerAccount\" GROUP BY kind ORDER BY kind;\nSELECT action,details FROM \"AdminAudit\" WHERE action IN('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY \"createdAt\" DESC,id DESC LIMIT 1;\nROLLBACK;\n`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=(key:string)=>args[args.indexOf(key)+1];
 for(const key of ['--inventory','--schema','--recovery','--output','--run'])ensure(args.includes(key),`Missing ${key}`);
 const data=JSON.parse(fs.readFileSync(get('--inventory'),'utf8')),schema=JSON.parse(fs.readFileSync(get('--schema'),'utf8')),recovery=JSON.parse(fs.readFileSync(get('--recovery'),'utf8'));
 const {config,summary}=prepareReset(data,schema,recovery,{runId:get('--run'),reason:'Owner-reviewed catalog reset; separate compensation of actual net submission fees',review:args.includes('--review')?JSON.parse(fs.readFileSync(get('--review'),'utf8')):undefined});
 writeResetPackage(config,get('--output'));console.log(JSON.stringify({...summary,manifestHash:config.manifestHash,mode:'OFFLINE PREPARATION ONLY',acknowledgements:'Review required; no production execution performed'}));
}
