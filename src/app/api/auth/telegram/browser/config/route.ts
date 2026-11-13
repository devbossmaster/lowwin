import {browserLoginConfig} from '@/modules/auth/telegram-browser-protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Readiness has no database, session, rate-limit or provider dependencies.
export function GET(){return Response.json(browserLoginConfig(),{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}})}
