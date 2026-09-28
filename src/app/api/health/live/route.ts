// Process liveness only. This intentionally makes no database-health claim.
export function GET(){return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}})}
