import {NextRequest,NextResponse} from 'next/server';
import {getMiniSession,localMiniPreview} from '@/modules/auth/mini-access';

// These handlers enforce getMiniSession/requireUser themselves before any
// private read or mutation. Do not run another full session lookup in Proxy.
const guardedApis=new Set(['/api/me','/api/my-bids','/api/favorites','/api/profile','/api/profile/wins','/api/alerts','/api/fulfillment','/api/support','/api/wallet','/api/wallet/top-ups','/api/wallet/scan','/api/wallet/preview']);
const publicAssets=new Set(['/logo.png','/banner1.png','/fonts/NotoSansEthiopic-Bold.ttf','/fonts/poppins-latin-400.woff2','/fonts/poppins-latin-500.woff2','/fonts/poppins-latin-600.woff2','/fonts/poppins-latin-700.woff2']);

export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  if(path==='/api/health/live')return NextResponse.next();
  // Public onboarding artwork must load before a Telegram session exists.
  // Keep this exact allowlist separate from all protected Mini App data.
  if(publicAssets.has(path))return NextResponse.next();
  // The media handler authorizes unpublished uploads with a verified staff
  // session and serves published product photos. Staff do not have Mini sessions.
  if(/^\/api\/media\/[0-9a-f-]{36}$/i.test(path))return NextResponse.next();
  if(guardedApis.has(path)||/^\/api\/favorites\/[a-z0-9-]{1,120}$/.test(path)||/^\/api\/auctions\/[a-z0-9-]{1,120}\/bids$/.test(path))return NextResponse.next();
  // Verify.et calls this exact endpoint without a Telegram session. The route
  // validates its signed raw body before accepting a test or payment event.
  if(path==='/api/payments/verify-et/webhook'||path==='/telegram'||path==='/api/onboarding/contact'||path.startsWith('/admin')||path.startsWith('/api/admin/')||path.startsWith('/api/auth/')||path.startsWith('/api/bot/'))return NextResponse.next();
  let allowed=false,unavailable=false;
  try { allowed=localMiniPreview(request.headers)||!!await getMiniSession(request.headers); } catch { unavailable=true; }
  // An unavailable database is not an invalid login. Keep access closed, but
  // let API clients offer Retry instead of treating a live session as signed out.
  const response=allowed?NextResponse.next():path.startsWith('/api/')?NextResponse.json({error:unavailable?'Connection interrupted. Please retry.':'Open Lowwin through the Telegram bot.'},{status:unavailable?503:401}):unavailable?new NextResponse('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Try again | Lowwin</title><body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#eef5f0;color:#172720;font-family:system-ui,sans-serif"><main style="padding:32px;text-align:center"><h1 style="font-size:28px">Connection busy</h1><p>Please try again.</p><a href="" style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;min-width:130px;border-radius:12px;background:#0bda51;color:#172412;text-decoration:none;font-weight:600">Retry</a></main></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}}):NextResponse.redirect(new URL('/telegram',request.url));
  if(unavailable)response.headers.set('Retry-After','5');
  response.headers.set('Cache-Control','private, no-store, max-age=0');
  response.headers.set('Vary','Cookie');
  response.headers.set('X-Robots-Tag','noindex');
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|catalog/|icons/).*)']};
