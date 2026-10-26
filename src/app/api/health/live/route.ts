// Process liveness only. This intentionally makes no database-health claim.
export function GET(){const revision=process.env.APP_REVISION??process.env.VERCEL_GIT_COMMIT_SHA;return new Response(null,{status:204,headers:{'Cache-Control':'no-store',...(revision&&/^[a-f0-9]{7,40}$/i.test(revision)?{'X-App-Revision':revision}:{})}})}
