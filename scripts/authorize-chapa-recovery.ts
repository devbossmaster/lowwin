import 'dotenv/config';
import {PrismaClient,type ChapaCheckout} from '@prisma/client';
import {parseArgs} from 'node:util';
import {runtimeDatabaseUrl} from '../src/lib/database-config';
import {chapaAvailability,chapaTransport,isChapaHostedSessionReference,parseChapaEvidence} from '../src/modules/payments/chapa-provider';
import {matchesChapaMetadata} from '../src/modules/payments/chapa-metadata';
import {recoveryAuthorizationAction,recoveryAuthorizationKey,recoveryBindingHash,type ChapaRecoveryBinding} from '../src/modules/payments/chapa-recovery-binding';

// Operator CLI only. A browser, webhook or return URL cannot grant this approval.
// It authenticates the same existing payment through the new merchant key and
// records a bounded audit authorization. No initialization or credit occurs here.
async function main(){
 const {values}=parseArgs({options:{checkout:{type:'string'},merchant:{type:'string'},'amount-cents':{type:'string'},'final-reference':{type:'string'},confirm:{type:'boolean',default:false}},strict:true});
 const id=values.checkout,merchant=values.merchant,amount=values['amount-cents'],final=values['final-reference'];
 if(!id||!merchant||!amount||!final)throw Error('Use --checkout UUID --merchant REFERENCE --amount-cents INTEGER --final-reference REFERENCE [--confirm]');
 const health=chapaAvailability();if(!health.configured||!health.recoveryEnabled||health.enabled)throw Error('Pause CHAPA_ENABLED; keep reviewed recovery enabled before authorizing recovery.');
 const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DATABASE_URL),log:[]});
 try{
  const order=await db.chapaCheckout.findUniqueOrThrow({where:{id}});
  const validate=(row:ChapaCheckout)=>{
   if(row.id!==id||row.mode!==health.mode||row.merchantReference!==merchant||row.amountCents.toString()!==amount||row.currency!=='ETB')throw Error('Frozen checkout identity, mode or money does not match the explicit review.');
   if(row.credentialFingerprint===health.credentialFingerprint)throw Error('This checkout already has the current credential binding; no rotation approval is needed.');
   if(row.creditJournalId)throw Error('Payment is already credited; no recovery approval is needed.');
   if(row.chapaReference&&row.chapaReference!==final&&!isChapaHostedSessionReference(row.checkoutUrl,row.chapaReference,health.mode))throw Error('A different final payment reference is already bound.');
  };validate(order);
  // Provider HTTP stays outside the financial/audit transaction.
  const evidence=parseChapaEvidence(await chapaTransport.lookup(order.merchantReference));
  if(!evidence||evidence.status!=='SUCCESS'||evidence.merchantReference!==merchant||evidence.amountCents!==amount||evidence.currency!==order.currency||evidence.chapaReference!==final||evidence.mode&&evidence.mode!==health.mode||!matchesChapaMetadata(order.initialization,evidence.meta,order.id))throw Error('Merchant-authenticated terminal verification does not match this checkout.');
  const operationKey=`chapa:credential-recovery:${id}:${health.credentialFingerprint}`;
  const old=await db.adminAudit.findUnique({where:{operationKey}});
  const candidate:ChapaRecoveryBinding={checkoutId:order.id,mode:health.mode,fromFingerprint:order.credentialFingerprint,toFingerprint:health.credentialFingerprint!,requestHash:order.requestHash,merchantReference:merchant,amountCents:amount,currency:'ETB',finalReference:final,expiresAt:new Date(Date.now()+23*3600000).toISOString()};
  const binding=old?(old.details as unknown as {binding:ChapaRecoveryBinding}).binding:candidate;
  if(!binding||Date.parse(binding.expiresAt)<=Date.now()||binding.checkoutId!==id||binding.toFingerprint!==health.credentialFingerprint||binding.fromFingerprint!==order.credentialFingerprint||binding.requestHash!==order.requestHash||binding.mode!==health.mode||binding.merchantReference!==merchant||binding.amountCents!==amount||binding.currency!=='ETB'||binding.finalReference!==final||old&&(old.action!==recoveryAuthorizationAction||old.target!==id||old.requestHash!==recoveryBindingHash(binding)))throw Error('Existing recovery audit requires explicit review.');
  if(!values.confirm){console.log(JSON.stringify({reviewOnly:true,paymentVerified:true,checkoutId:id,mode:health.mode,amountCents:amount,currency:'ETB',authorizationRecorded:!!old,creditApplied:false}));return}
  await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${order.userId}`},0))`;
   const [locked]=await tx.$queryRaw<ChapaCheckout[]>`SELECT * FROM "ChapaCheckout" WHERE id=${id} FOR UPDATE`;
   if(!locked)throw Error('Checkout unavailable');validate(locked);
   if(locked.requestHash!==order.requestHash||locked.credentialFingerprint!==order.credentialFingerprint)throw Error('Frozen intent changed during review.');
   if(!old)await tx.adminAudit.create({data:{actorId:'system:operator-reviewed-chapa-recovery',action:recoveryAuthorizationAction,target:id,operationKey:recoveryAuthorizationKey(binding),requestHash:recoveryBindingHash(binding),details:{binding,verificationHash:evidence.hash,reason:'Operator explicitly reviewed a successful existing checkout after merchant-key replacement; original intent preserved.'}}});
  },{maxWait:15000,timeout:20000});
  console.log(JSON.stringify({authorizationRecorded:true,creditApplied:false,checkoutId:id,expiresAt:binding.expiresAt,CHAPA_RECOVERY_BINDINGS:JSON.stringify([binding])},null,2));
 }finally{await db.$disconnect()}
}
void main().catch(error=>{console.error(JSON.stringify({error:'RECOVERY_AUTHORIZATION_FAILED',message:error instanceof Error&&!(error as {code?:string}).code?error.message:'Check the existing checkout, merchant configuration and database access. No credit was applied.'}));process.exitCode=1});
