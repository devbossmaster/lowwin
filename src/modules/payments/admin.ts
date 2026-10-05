import {adminPlayerContacts,playerSearch} from '../admin/people';
import {protectedPayment,STAFF_ATTEMPTS,RECOVERY_WINDOW_MS} from './retry';
import {depositAttentionWhere} from './review-filter';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from '../admin/boundary';
import {AdminError} from '../admin/errors';
import {bankSchema,depositBankSchema,canonical,hash,PaymentError} from './provider';
import {paymentHealth,reconcilePayments,verifyIntent} from './service';
import {reconcile} from '../wallet/ledger';
import {DEPOSIT_CHANNELS} from '@/lib/payment-channels';
import {approveReviewedDeposit,canReviewDeposit} from './manual-approval';
const key=z.string().uuid(),reason=z.string().trim().min(8).max(500),optionalNote=z.string().trim().max(500).optional().default(''),integer=z.string().regex(/^[1-9]\d{0,10}$/);
const policySchema=z.object({key,channel:depositBankSchema,version:z.number().int().min(0),enabled:z.boolean(),account:z.string().regex(/^\d{10,16}$/),accountName:z.string().trim().min(3).max(120),pointsNumerator:integer,centsDenominator:integer,minCents:integer,maxCents:integer,terms:z.string().trim().min(40).max(3000).optional(),reviewReference:reason.optional(),accountConfirmed:z.boolean().optional(),reason:optionalNote,confirmation:z.string().optional()}).strict().refine(value=>value.channel==='cbe'||/^(?:0|251)[79]\d{8}$/.test(value.account),{path:['account'],message:'Use an Ethiopian wallet phone number: 07..., 09... or 251...'});
type MaterialPolicy=z.infer<typeof policySchema>&{terms:string;reviewReference:string};
function policyData(b:MaterialPolicy){const {key:_,reason:__,confirmation:___,accountConfirmed:____,...data}=b;return data}
function allow(role:string,write=false){if(!(write?['OWNER','PAYMENTS_OPERATOR']:['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT']).includes(role))throw new AdminError(403,'Payment operations are not granted to this role.')}
const mask=(s:string|null)=>s?`••••${s.slice(-4)}`:null;
export async function paymentAdminRead(client:PrismaClient,headers:Headers,path:string[],params:URLSearchParams){const actor=await requireAdmin(client,headers);allow(actor.role);
 if(path[0]==='settings'){if(actor.role!=='OWNER')throw new AdminError(403,'Owner permission required.');const latest=await Promise.all(DEPOSIT_CHANNELS.map(channel=>client.paymentPolicy.findFirst({where:{channel},orderBy:{version:'desc'}})));return {health:paymentHealth(),policies:JSON.parse(JSON.stringify(latest,(_,v)=>typeof v==='bigint'?v.toString():v))}}
 const page=Math.max(1,Math.min(100000,Math.floor(Number(params.get('page'))||1))),query=params.get('q')?.slice(0,100),status=params.get('status')?.slice(0,40),caseState=params.get('caseState')?.slice(0,40);
 if(path[0]==='incidents'){if(actor.role==='SUPPORT')throw new AdminError(403,'Evidence permission required.');return {agedPending:await client.topUpIntent.count({where:{status:{in:['PENDING','VERIFYING','PROVIDER_OUTAGE']},createdAt:{lt:new Date(Date.now()-3600000)}}}),duplicates:await client.topUpIntent.count({where:{status:'DUPLICATE_CONFLICT'}}),providerOutage:await client.topUpIntent.count({where:{status:'PROVIDER_OUTAGE'}}),disputes:await client.topUpIntent.count({where:{caseState:{in:['ESCALATED','REVERSAL_REVIEW']}}}),statementUnmatched:await client.paymentStatementEntry.count({where:{status:{not:'MATCHED'}}}),ledgerDrift:(await reconcile(client)).length,paymentDrift:(await reconcilePayments(client)).length,health:paymentHealth()}}
 if(path[0]==='statements'){if(actor.role==='SUPPORT')throw new AdminError(403,'Evidence permission required.');const [items,total]=await client.$transaction([client.paymentStatementEntry.findMany({orderBy:{createdAt:'desc'},take:25,skip:(page-1)*25}),client.paymentStatementEntry.count()]);return JSON.parse(JSON.stringify({items:items.map(item=>({...item,reference:mask(item.reference)})),total,page,totalPages:Math.ceil(total/25)},(_,v)=>typeof v==='bigint'?v.toString():v))}
 if(path[0]){
  const t=await client.topUpIntent.findUnique({where:{id:path[0]}});if(!t)throw new PaymentError(404,'Deposit not found.');
  const players=await adminPlayerContacts(client,[t.userId]);
  await client.adminAudit.create({data:{actorId:actor.id,action:'DEPOSIT_PLAYER_CONTACT_READ',target:t.id,details:{}}});
  const base={id:t.id,status:t.status,createdAt:t.createdAt.toISOString(),caseState:t.caseState,assignedTo:t.assignedTo,reason:t.reasonCode,player:players[0]??null,channel:t.channel,reference:mask(t.reference)};
  if(actor.role==='SUPPORT')return base;
  const [claim,attempts,notes,active]=await Promise.all([client.paymentClaim.findUnique({where:{intentId:t.id},select:{amountCents:true,points:true,transferredAt:true}}),client.paymentAttempt.findMany({where:{intentId:t.id},orderBy:{createdAt:'desc'},take:20,select:{code:true,createdAt:true}}),client.adminAudit.findMany({where:{target:t.id,action:{startsWith:'PAYMENT_'}},orderBy:{createdAt:'desc'},take:20,select:{action:true,details:true,createdAt:true}}),client.verifyRequest.findFirst({where:{intentId:t.id,state:{in:['SUBMITTING','PROCESSING']}},select:{id:true}})]);
  const retryWindow=!!t.expiresAt&&actor.now.getTime()<=t.expiresAt.getTime()+RECOVERY_WINDOW_MS;
  return JSON.parse(JSON.stringify({...base,canApprove:['OWNER','PAYMENTS_OPERATOR'].includes(actor.role)&&paymentHealth().enabled&&canReviewDeposit(t,actor.now,!!active,!!claim),referenceFull:['OWNER','PAYMENTS_OPERATOR'].includes(actor.role)?t.reference:undefined,expectedCents:t.expectedCents,receiver:mask(t.receivingAccount),accountName:t.accountName,points:t.points,claim,attempts,notes:notes.map(n=>({...n,details:{reason:typeof (n.details as {reason?:unknown}).reason==='string'?(n.details as {reason:string}).reason:''}})),canRetry:!!t.reference&&!protectedPayment(t)&&retryWindow&&t.attempts<STAFF_ATTEMPTS&&!active&&t.nextAttemptAt<=actor.now&&(!t.leaseUntil||t.leaseUntil<=actor.now),canRecover:!!t.reference&&!protectedPayment(t)&&retryWindow&&t.attempts<STAFF_ATTEMPTS&&!active&&attempts.some(a=>a.code==='PROVIDER_OUTAGE')},(_,v)=>typeof v==='bigint'?v.toString():v));
 }
 if(status&&!['PENDING','VERIFYING','NEEDS_REVIEW','DUPLICATE_CONFLICT','PROVIDER_OUTAGE','CREDITED','REJECTED'].includes(status))throw new PaymentError(422,'Choose a valid deposit status.');if(caseState&&!['OPEN','INVESTIGATING','ESCALATED','RESOLVED','REVERSAL_REVIEW','ARCHIVED'].includes(caseState))throw new PaymentError(422,'Choose a valid case state.');if(params.has('view')&&!['attention','all'].includes(params.get('view')!))throw new PaymentError(422,'Choose a valid deposit view.');
 const where:Prisma.TopUpIntentWhereInput={...(params.get('view')==='attention'?depositAttentionWhere(actor.now):{provider:{in:['CHECK_ET','VERIFY_ET']},caseState:{not:'ARCHIVED'}}),...(status?{status}:{}),...(caseState?{caseState}:{}),...(query?{AND:[{OR:[{id:{contains:query}},{reference:{contains:query,mode:'insensitive'}},{user:playerSearch(query)}]}]}:{})};
 const [items,total]=await client.$transaction([client.topUpIntent.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*25,take:25,select:{id:true,userId:true,channel:true,status:true,createdAt:true,caseState:true,assignedTo:true,reasonCode:true,...(actor.role==='SUPPORT'?{}:{expectedCents:true,reference:true})}}),client.topUpIntent.count({where})]);
 const players=await adminPlayerContacts(client,items.map(t=>t.userId));
 if(items.length)await client.adminAudit.create({data:{actorId:actor.id,action:'DEPOSIT_PLAYER_CONTACT_LIST_READ',target:'deposits',details:{count:items.length}}});
 return JSON.parse(JSON.stringify({items:items.map(t=>({...t,player:players.find(p=>p.id===t.userId)??null,...('reference' in t?{reference:mask(t.reference as string|null)}:{})})),total,page,totalPages:Math.ceil(total/25)},(_,v)=>typeof v==='bigint'?v.toString():v));
}

export async function paymentAdminCommand(client:PrismaClient,headers:Headers,action:string,raw:unknown){
 const initial=await requireAdmin(client,headers);allow(initial.role,true);
 if(action==='approve')return approveReviewedDeposit(client,headers,raw);
 if(action==='preview-policy'||action==='publish-policy'){
  if(initial.role!=='OWNER')throw new AdminError(403,'Owner permission required.');
  const parsed=policySchema.parse(raw);const previous=await client.paymentPolicy.findFirst({where:{channel:parsed.channel},orderBy:{version:'desc'}});
  if(!parsed.reviewReference&&!parsed.accountConfirmed&&(!previous||previous.account!==parsed.account||previous.accountName!==parsed.accountName))throw new PaymentError(422,'Confirm that you checked the receiving account details.');
  const b:MaterialPolicy={...parsed,terms:parsed.terms??previous?.terms??'Deposits are added in ETB after the transaction ID, amount, date and receiving account are verified. Each transfer is credited once. Contact Lowwin support for payment questions.',reviewReference:parsed.reviewReference??(previous?.account===parsed.account&&previous.accountName===parsed.accountName?previous.reviewReference:'Owner confirmed receiving account details')};if(BigInt(b.minCents)>BigInt(b.maxCents))throw new PaymentError(422,'Minimum exceeds maximum.');if(BigInt(b.pointsNumerator)*100n!==BigInt(b.centsDenominator))throw new PaymentError(422,'The ETB quote must credit exactly ETB 1.00 per ETB 1.00 transferred.');const confirmation=hash(JSON.stringify(policyData(b)));
  if(action==='preview-policy'){await requireAdmin(client,headers,{fresh:true});const previous=await client.paymentPolicy.findFirst({where:{channel:b.channel},orderBy:{version:'desc'}});return {previous:previous?JSON.parse(JSON.stringify(previous,(_,v)=>typeof v==='bigint'?v.toString():v)):null,proposed:{...policyData(b),version:b.version+1},confirmation,health:paymentHealth()}}
  if(b.confirmation!==confirmation)throw new PaymentError(409,'Review the exact configuration before publishing.');return client.$transaction(async tx=>{const actor=await requireAdmin(tx,headers,{fresh:true,lock:true});if(actor.role!=='OWNER')throw new AdminError(403,'Owner permission required.');await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-policy:${b.channel}`},0))`;
   const prior=await tx.adminAudit.findUnique({where:{operationKey:b.key}}),fingerprint=hash(JSON.stringify(b));if(prior){if(prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');return {saved:true}}
   const latest=await tx.paymentPolicy.findFirst({where:{channel:b.channel},orderBy:{version:'desc'}});if((latest?.version??0)!==b.version)throw new PaymentError(409,'Configuration changed. Review again.');const data=policyData(b),policy=await tx.paymentPolicy.create({data:{...data,version:b.version+1,pointsNumerator:BigInt(b.pointsNumerator),centsDenominator:BigInt(b.centsDenominator),minCents:BigInt(b.minCents),maxCents:BigInt(b.maxCents),actorId:actor.id}});
   await tx.adminAudit.create({data:{actorId:actor.id,action:'PAYMENT_POLICY',target:policy.id,operationKey:b.key,requestHash:fingerprint,details:{sessionId:actor.sessionId,reason:b.reason||'Receiving account updated by Owner',channel:b.channel,version:policy.version,configurationHash:confirmation}}});return {saved:true,version:policy.version};
  });
 }
 const body=z.object({key,id:z.string().uuid(),reason:optionalNote,state:z.enum(['OPEN','INVESTIGATING','ESCALATED','RESOLVED','REVERSAL_REVIEW']).optional()}).strict().parse(raw);
 if(!['note','retry','recover','case','reject','archive'].includes(action))throw new PaymentError(422,'Unknown payment command.');
 if(action==='note'&&!body.reason)throw new PaymentError(422,'Write a note before saving it.');
 if(action==='recover')await requireAdmin(client,headers,{fresh:true});
 const t=await client.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "TopUpIntent" WHERE id=${body.id} FOR UPDATE`;const actor=await requireAdmin(tx,headers,{lock:true});allow(actor.role,true);const t=await tx.topUpIntent.findUnique({where:{id:body.id}});if(!t)throw new PaymentError(404,'Top-up not found.');const fingerprint=hash(JSON.stringify({action,...body})),prior=await tx.adminAudit.findUnique({where:{operationKey:body.key}});if(prior){if(prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');return t}
  if(action==='recover')await requireAdmin(tx,headers,{fresh:true,lock:true});
  if(action==='reject'){
   if(t.status==='CREDITED'||await tx.paymentClaim.findUnique({where:{intentId:t.id}}))throw new PaymentError(409,'A credited deposit cannot be rejected. Use the audited reversal process.');
   if(t.leaseUntil&&t.leaseUntil>actor.now||await tx.verifyRequest.findFirst({where:{intentId:t.id,state:{in:['SUBMITTING','PROCESSING']}},select:{id:true}}))throw new PaymentError(409,'Verification is running. Wait for its result before rejecting.');
   if(t.status==='REJECTED')throw new PaymentError(409,'This deposit is already rejected.');
   await tx.topUpIntent.update({where:{id:t.id},data:{status:'REJECTED',reasonCode:'ADMIN_REJECTED',caseState:'RESOLVED',assignedTo:actor.id,leaseToken:null,leaseUntil:null}});
  }
  if(action==='archive'){
   if(!['CREDITED','REJECTED'].includes(t.status)||['ESCALATED','REVERSAL_REVIEW'].includes(t.caseState))throw new PaymentError(409,'Finish or reject this deposit before archiving it. Open disputes must remain visible.');
   await tx.topUpIntent.update({where:{id:t.id},data:{caseState:'ARCHIVED',assignedTo:actor.id}});
  }
  if(action==='case')await tx.topUpIntent.update({where:{id:t.id},data:{caseState:body.state??'INVESTIGATING',assignedTo:actor.id}});
  await tx.adminAudit.create({data:{actorId:actor.id,action:`PAYMENT_${action.toUpperCase()}`,target:t.id,operationKey:body.key,requestHash:fingerprint,details:{sessionId:actor.sessionId,reason:body.reason||`Deposit ${action} recorded by staff`,...(body.state?{state:body.state}:{})}}});return t});
 if(action==='retry'){if(!t.reference)throw new PaymentError(409,'The user must submit a reference first.');return verifyIntent(client,t.userId,{id:t.id,key:body.key,input:t.reference},undefined,async tx=>{const actor=await requireAdmin(tx,headers,{lock:true});allow(actor.role,true)},false,true)}
 if(action==='recover'){if(!t.reference)throw new PaymentError(409,'The user must submit a reference first.');return verifyIntent(client,t.userId,{id:t.id,key:body.key,input:t.reference},undefined,async tx=>{const actor=await requireAdmin(tx,headers,{fresh:true,lock:true});allow(actor.role,true)},true)}
 return {recorded:true};
}
export async function recordStatement(client:PrismaClient,headers:Headers,raw:unknown){const b=z.object({key,channel:bankSchema,reference:z.string().max(128),amountCents:integer,account:z.string().regex(/^\d{10,16}$/),transferredAt:z.iso.datetime({offset:true}),evidenceReference:reason,reason}).strict().parse(raw);return client.$transaction(async tx=>{const actor=await requireAdmin(tx,headers,{lock:true});allow(actor.role,true);const fingerprint=hash(JSON.stringify(b)),prior=await tx.adminAudit.findUnique({where:{operationKey:b.key}});if(prior){if(prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');return {recorded:true}}
 const reference=canonical(b.channel,b.reference),claim=await tx.paymentClaim.findUnique({where:{channel_reference:{channel:b.channel,reference}}}),intent=claim?await tx.topUpIntent.findUnique({where:{id:claim.intentId}}):null;
 const status=claim&&claim.amountCents===BigInt(b.amountCents)&&intent?.receivingAccount===b.account&&Math.abs(claim.transferredAt.getTime()-new Date(b.transferredAt).getTime())<=60000?'MATCHED':claim?'MISMATCH':'UNMATCHED';const entry=await tx.paymentStatementEntry.create({data:{channel:b.channel,reference,amountCents:BigInt(b.amountCents),receiverSuffix:b.account.slice(-4),transferredAt:new Date(b.transferredAt),evidenceReference:b.evidenceReference,status,intentId:claim?.intentId,actorId:actor.id}});
 await tx.adminAudit.create({data:{actorId:actor.id,action:'PAYMENT_STATEMENT',target:entry.id,operationKey:b.key,requestHash:fingerprint,details:{sessionId:actor.sessionId,reason:b.reason,status}}});return {recorded:true,status};})}
