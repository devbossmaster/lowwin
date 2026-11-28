import type {PrismaClient} from '@prisma/client';

const readiness=new WeakMap<PrismaClient,Promise<boolean>>();
const capacityReadiness=new WeakMap<PrismaClient,Promise<boolean>>();

// Keep rolling deployments compatible with databases awaiting either migration.
// A shared promise avoids a catalog lookup per delivery lane or message.
export function notificationDatabasePathReady(client:PrismaClient):Promise<boolean>{
 const cached=readiness.get(client);
 if(cached)return cached;

 const check=client.$queryRaw<{ready:boolean}[]>`
  SELECT current_setting('default_transaction_isolation')='read committed'
   AND COALESCE(has_function_privilege(to_regprocedure('public.lowwin_claim_notifications(text,integer,text,text,boolean)'),'EXECUTE'),false)
   AND COALESCE(has_function_privilege(to_regprocedure('public.lowwin_gate_notification(jsonb)'),'EXECUTE'),false) AS ready
 `.then(rows=>rows[0]?.ready===true,()=>{
  readiness.delete(client);
  return false;
 });
 readiness.set(client,check);
 return check;
}

export function notificationSendCapacityReady(client:PrismaClient):Promise<boolean>{
 const cached=capacityReadiness.get(client);
 if(cached)return cached;
 const check=client.$queryRaw<{ready:boolean}[]>`
  SELECT current_setting('default_transaction_isolation')='read committed'
   AND COALESCE(has_function_privilege(to_regprocedure('public.lowwin_reserve_telegram_send(text,text,text,integer,integer,integer)'),'EXECUTE'),false)
   AND COALESCE(has_function_privilege(to_regprocedure('public.lowwin_reserve_notification_send(jsonb,text,text,text,integer,integer,integer)'),'EXECUTE'),false) AS ready
 `.then(rows=>rows[0]?.ready===true,()=>{
  capacityReadiness.delete(client);
  return false;
 });
 capacityReadiness.set(client,check);
 return check;
}
