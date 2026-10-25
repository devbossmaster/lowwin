export const CONTACT_APPROVAL_TIMEOUT_MS=30_000;

// Telegram may never answer its native contact popup. A late or duplicate
// callback must not restart a cancelled, retried or expired contact attempt.
export function watchContactApproval(onResult:(shared:boolean)=>void,onTimeout:()=>void){
 let pending=true;
 const timer=setTimeout(()=>{if(!pending)return;pending=false;onTimeout()},CONTACT_APPROVAL_TIMEOUT_MS);
 return {
  respond(shared:boolean){if(!pending)return;pending=false;clearTimeout(timer);onResult(shared)},
  cancel(){pending=false;clearTimeout(timer)},
 };
}
