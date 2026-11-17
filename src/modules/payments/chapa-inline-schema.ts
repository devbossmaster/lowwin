import type {PrismaClient} from '@prisma/client';
import {CHAPA_INLINE_MIGRATION,CHAPA_CONFIRMATION_MIGRATIONS,type ChapaInlineSchemaSnapshot} from './chapa-inline-readiness';

/** Metadata only: no provider HTTP, customer rows or financial mutations.
 * A migration name alone cannot prove its columns and active guards survived. */
export async function readChapaInlineSchema(db:PrismaClient):Promise<ChapaInlineSchemaSnapshot>{
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const migrations=await tx.$queryRaw<{migration_name:string}[]>`SELECT migration_name FROM public._prisma_migrations WHERE migration_name IN (${CHAPA_INLINE_MIGRATION},${CHAPA_CONFIRMATION_MIGRATIONS[0]},${CHAPA_CONFIRMATION_MIGRATIONS[1]}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const applied=new Set(migrations.map(row=>row.migration_name));
  const columns=await tx.$queryRaw<{table_name:string;column_name:string;data_type:string;is_nullable:string;column_default:string|null}[]>`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('ChapaCheckout','ChapaWebhookEvent')`;
  const column=(table:string,name:string,type:string,nullable=true,zero=false)=>columns.some(row=>row.table_name===table&&row.column_name===name&&row.data_type===type&&row.is_nullable===(nullable?'YES':'NO')&&(!zero||/^0(?:::integer)?$/.test(row.column_default??'')));
  const constraints=await tx.$queryRaw<{table_name:string;name:string;definition:string}[]>`SELECT t.relname AS table_name,c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ChapaCheckout' AND c.convalidated`;
  const triggers=await tx.$queryRaw<{table_name:string;name:string;function_name:string;body:string;events:number}[]>`SELECT t.relname AS table_name,g.tgname AS name,p.proname AS function_name,p.prosrc AS body,g.tgtype::integer AS events FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_proc p ON p.oid=g.tgfoid WHERE n.nspname='public' AND t.relname IN ('ChapaCheckout','ChapaWebhookEvent') AND NOT g.tgisinternal AND g.tgenabled IN ('O','A')`;
  const indexes=await tx.$queryRaw<{name:string}[]>`SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND i.indisvalid AND i.indisready AND c.relname IN ('ChapaCheckout_inline_v2_reconcile_idx','ChapaWebhookEvent_checkoutId_receivedAt_idx')`;
  const activeGuard=(table:string,name:string,fn:string,events:number)=>triggers.find(row=>row.table_name===table&&row.name===name&&row.function_name===fn&&(row.events&events)===events);
  const event=activeGuard('ChapaWebhookEvent','protect_chapa_event_job','protect_chapa_event_job',27),flow=activeGuard('ChapaCheckout','chapa_flow_guard','protect_chapa_flow',19);
  const comparisons=(body:string,fields:string[])=>body.includes('IS DISTINCT FROM')&&body.includes('RAISE EXCEPTION')&&fields.every(field=>body.includes(`NEW."${field}"`)&&body.includes(`OLD."${field}"`));
  const completion=constraints.find(row=>row.name==='ChapaCheckout_verificationCompletionStatus_check')?.definition??'';
  return {
   migrationApplied:applied.has(CHAPA_INLINE_MIGRATION),signalMigrationApplied:applied.has(CHAPA_CONFIRMATION_MIGRATIONS[0]),signalGuardsMigrationApplied:applied.has(CHAPA_CONFIRMATION_MIGRATIONS[1]),
   identityConstraint:constraints.some(row=>row.name==='chapa_v2_inline_identity'),guardTrigger:!!activeGuard('ChapaCheckout','chapa_inline_v2_guard','protect_chapa_inline_v2',19),reconcileIndex:indexes.some(row=>row.name==='ChapaCheckout_inline_v2_reconcile_idx'),
   signalColumns:column('ChapaCheckout','providerCancelledBy','text')&&column('ChapaCheckout','verificationSignalVersion','integer',false,true)&&column('ChapaCheckout','verificationHandledSignalVersion','integer',false,true)&&column('ChapaCheckout','lastPrivateCheckAt','timestamp without time zone')&&column('ChapaCheckout','verificationRetryAfter','timestamp without time zone')&&column('ChapaCheckout','verificationCompletionStatus','text'),
   webhookFeedbackColumns:['providerReasonCode','cancelledBy','paymentMethod'].every(name=>column('ChapaWebhookEvent',name,'text'))&&column('ChapaWebhookEvent','providerUpdatedAt','timestamp without time zone'),
   signalIndex:indexes.some(row=>row.name==='ChapaWebhookEvent_checkoutId_receivedAt_idx'),
   eventFeedbackGuard:!!event&&comparisons(event.body,['providerReasonCode','cancelledBy','providerUpdatedAt','paymentMethod'])&&event.body.includes("TG_OP='DELETE'"),
   providerEvidenceGuard:!!flow&&comparisons(flow.body,['providerStatus','verificationState','initializationErrorCode','initializationHttpStatus','providerCancelledBy'])&&flow.body.includes('OLD."creditJournalId" IS NOT NULL'),
   completionStatusConstraint:completion.includes('"verificationCompletionStatus"')&&['SUCCESS','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED'].every(status=>completion.includes(`'${status}'::text`)),
  };
 },{maxWait:5000,timeout:10000});
}
