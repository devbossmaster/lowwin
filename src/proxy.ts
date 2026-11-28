import {NextRequest,NextResponse} from 'next/server';
import {getMiniSession,localMiniPreview} from '@/modules/auth/mini-access';
import {signedSessionToken} from '@/modules/auth/signed-session';
import {miniReturnPath} from '@/lib/mini-return';
import {customerLoginPath} from '@/lib/customer-login-entry';
import {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {isPublicMiniPage,isPublicMiniRead} from '@/lib/mini-public-routes';
import {LOWWIN_BANNER_SRC,LOWWIN_BODY_FONT_SRC,LOWWIN_DISPLAY_FONT_SRC,LOWWIN_ETHIOPIC_FONT_SRC,LOWWIN_HOME_BANNER_SRC,LOWWIN_HOME_MOBILE_BANNER_SRC,LOWWIN_ICON_SRC,LOWWIN_LOGO_SRC} from '@/lib/brand';
import {referralCodeFromParams} from '@/lib/referral-invite';
import {sealWebsiteReferral,WEBSITE_REFERRAL_COOKIE,WEBSITE_REFERRAL_COOKIE_MAX_AGE} from '@/modules/referrals/website-cookie';

// Keep built-in marketing assets available to existing cached page bundles.
const previousBrandAssets=new Set(['/images/lowwin-home-16x9-en-20261114-v3.webp','/images/lowwin-home-16x9-am-20261114-v3.webp','/images/lowwin-light-blue-banner-en-20261114-v3.webp','/images/lowwin-light-blue-banner-am-20261114-v3.webp','/images/lowwin-home-16x9-en-20261114-v2.webp','/images/lowwin-home-16x9-am-20261114-v2.webp','/images/lowwin-light-blue-banner-en-20261114-v2.webp','/images/lowwin-light-blue-banner-am-20261114-v2.webp','/images/lowwin-flat-mark-20261114.svg','/images/lowwin-flat-icon-20261114.png','/images/lowwin-hammer-mark-20261114.svg','/images/lowwin-hammer-icon-20261114.png','/images/lowwin-ribbon-l-blue-20261114.webp','/images/lowwin-ribbon-l-icon-20261114.png','/images/lowwin-home-16x9-en-20261114.webp','/images/lowwin-home-16x9-am-20261114.webp','/images/lowwin-light-blue-banner-en-20261114.webp','/images/lowwin-light-blue-banner-am-20261114.webp']);

previousBrandAssets.add('/images/lowwin-blue-black-prizes-20261117.webp');
previousBrandAssets.add('/images/lowwin-blue-black-prizes-20261118.webp');
previousBrandAssets.add('/images/lowwin-family-home-blue-mobile-20261118.webp');
previousBrandAssets.add('/images/lowwin-family-home-blue-20261118.webp');

// These handlers enforce getMiniSession/requireUser themselves before any
// private read or mutation. Do not run another full session lookup in Proxy.
const guardedApis=new Set(['/api/me','/api/my-bids','/api/my-bids/refunds','/api/results','/api/results/winners','/api/favorites','/api/profile','/api/profile/wins','/api/alerts','/api/fulfillment','/api/support','/api/wallet','/api/wallet/top-ups','/api/wallet/scan','/api/wallet/preview','/api/payments/arifpay','/api/payments/arifpay/checkouts']);
const publicAssets=new Set(['/images/lowwin-logo-20261030.webp','/images/lowwin-icon-20261030.png','/logonew.png','/logo.png','/images/lowwin-launch-mark.webp','/images/chapa-logo.svg','/banner11.png','/images/lowin-family-hero.webp',"/images/lowwin-home-banner-en.webp","/images/lowwin-home-banner-am.webp",'/images/lowwin-demo-headphones.webp','/fonts/dm-sans-latin-400.woff2','/fonts/dm-sans-latin-500.woff2','/fonts/dm-sans-latin-600.woff2','/fonts/dm-sans-latin-700.woff2','/fonts/sora-latin-800.woff2','/fonts/noto-serif-ethiopic-banner.woff2','/fonts/noto-sans-ethiopic-variable.woff2','/fonts/NotoSansEthiopic-Bold.ttf','/fonts/poppins-latin-400.woff2','/fonts/poppins-latin-500.woff2','/fonts/poppins-latin-600.woff2','/fonts/poppins-latin-700.woff2']);

guardedApis.add('/api/referrals');
guardedApis.add('/api/referrals/telegram-share');
publicAssets.add('/images/lowwin-referral-share-20261119.jpg');
publicAssets.add(LOWWIN_BODY_FONT_SRC);
publicAssets.add(LOWWIN_DISPLAY_FONT_SRC);

const standaloneTypography=`@font-face{font-family:'DM Sans';src:url('${LOWWIN_BODY_FONT_SRC}') format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Outfit';src:url('${LOWWIN_DISPLAY_FONT_SRC}') format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Lowwin Ethiopic';src:url('${LOWWIN_ETHIOPIC_FONT_SRC}') format('woff2');font-weight:100 900;font-display:swap;unicode-range:U+030E,U+1200-1399,U+2D80-2DDE,U+AB01-AB2E,U+1E7E0-1E7FE}
body{font-family:'DM Sans','Lowwin Ethiopic',system-ui,sans-serif}h1,strong{font-family:'Outfit','Lowwin Ethiopic',system-ui,sans-serif}`;

export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  if(path==='/'&&request.method==='GET'&&!request.headers.has('next-router-prefetch')&&(request.headers.get('sec-fetch-dest')??'document')==='document'){
    const code=referralCodeFromParams(request.nextUrl.searchParams);
    const sealed=code&&!/prefetch|prerender/i.test(request.headers.get('sec-purpose')??request.headers.get('purpose')??'')?sealWebsiteReferral(code):null;
    if(sealed){
      const response=NextResponse.next();
      response.cookies.set(WEBSITE_REFERRAL_COOKIE,sealed,{httpOnly:true,sameSite:'lax',secure:request.nextUrl.protocol==='https:'||process.env.BETTER_AUTH_URL?.startsWith('https:'),path:'/',maxAge:WEBSITE_REFERRAL_COOKIE_MAX_AGE});
      response.headers.set('Cache-Control','private, no-store, max-age=0');
      return response;
    }
  }
  if((request.method==='GET'||request.method==='HEAD')&&isPublicMiniPage(path)||isPublicMiniRead(path,request.method))return NextResponse.next();
  if(path==='/api/health/live')return NextResponse.next();
  if((request.method==='GET'||request.method==='HEAD')&&path==='/video/cbe-bank-payment.mp4')return NextResponse.next();
  if(path==='/payments/ebirr.svg'||path==='/payments/cbe-bank.webp')return NextResponse.next();
  // Provider callbacks and owned checkout APIs enforce their own boundaries.
  if(path==='/api/payments/chapa/callback'||path==='/api/payments/chapa/webhook'||path==='/api/payments/chapa'||path==='/api/payments/chapa/checkouts'||/^\/api\/payments\/chapa\/checkouts\/[0-9a-f-]{36}$/i.test(path))return NextResponse.next();
  // The stream checks the signed session, ownership and expiry before sending
  // its first snapshot. A second session read here delays confirmation.
  if(request.method==='GET'&&/^\/api\/payments\/chapa\/checkouts\/[0-9a-f-]{36}\/events$/i.test(path))return NextResponse.next();
  // Direct/batch handlers require the owned payment session themselves. Keep
  // the same boundary without paying for another session lookup in Proxy.
  // Current Direct creation/configuration and the single-command bid/wallet
  // handlers enforce the same fresh session checks inside their own handlers.
  if(path==='/api/payments/chapa/direct/current'||path==='/api/payments/chapa/direct/current/config'||path==='/api/payments/chapa/direct/bid'||path==='/api/payments/chapa/batches/wallet')return NextResponse.next();
  if(path==='/api/payments/chapa/direct'||path==='/api/payments/chapa/inline'||path==='/api/payments/chapa/inline/config'||path==='/api/payments/chapa/methods'||path==='/api/payments/chapa/batches/quote'||/^\/api\/payments\/chapa\/batches\/[0-9a-f-]{36}\/wallet$/i.test(path)||/^\/api\/payments\/chapa\/checkouts\/[0-9a-f-]{36}\/authorize$/i.test(path))return NextResponse.next();
  // Public onboarding artwork must load before a Telegram session exists.
  // Keep this exact allowlist separate from all protected Mini App data.
  if(publicAssets.has(path)||previousBrandAssets.has(path)||path===LOWWIN_LOGO_SRC||path===LOWWIN_ICON_SRC||[...Object.values(LOWWIN_BANNER_SRC),...Object.values(LOWWIN_HOME_BANNER_SRC),...Object.values(LOWWIN_HOME_MOBILE_BANNER_SRC)].some(banner=>banner===path))return NextResponse.next();
  if((request.method==='GET'||request.method==='HEAD')&&['/images/how-it-works/choose-number.svg','/images/how-it-works/pay-entry.svg','/images/how-it-works/winning-result.svg'].includes(path))return NextResponse.next();
  if(path==='/images/lowwin-violet-hero-20261113.webp'||path==='/images/lowwin-blue-banner-en-20261113-v2.webp'||path==='/images/lowwin-blue-banner-am-20261113-v2.webp'||path==='/images/lowwin-blue-logo-20261113.webp'||path==='/images/lowwin-blue-icon-20261113.png')return NextResponse.next();
  if(path==='/fonts/inter-latin-variable.woff2')return NextResponse.next();
  const tutorial=resolveLearnMoreMedia({youtube:process.env.LOWIN_YOUTUBE_URL,local:process.env.LOWIN_HOW_TO_VIDEO_PATH,poster:process.env.LOWIN_HOW_TO_POSTER_PATH});
  if(tutorial&&(path===tutorial.poster||tutorial.kind==='local'&&path===tutorial.src))return NextResponse.next();
  // The media handler authorizes unpublished uploads with a verified staff
  // session and serves published product photos. Staff do not have Mini sessions.
  if(/^\/api\/media\/[0-9a-f-]{36}$/i.test(path))return NextResponse.next();
  // Transactions authorize the owner in their handlers, like wallet history.
  if(path==='/api/transactions'||/^\/api\/transactions\/wallet\/[0-9a-f-]{36}$/i.test(path))return NextResponse.next();
  if(/^\/api\/results\/[A-Za-z0-9-]{1,120}(?:\/breakdown)?$/.test(path)||/^\/api\/catalog\/auctions\/[A-Za-z0-9-]{1,120}$/.test(path)||guardedApis.has(path)||/^\/api\/payments\/arifpay\/checkouts\/[0-9a-f-]{36}$/i.test(path)||/^\/api\/favorites\/[a-z0-9-]{1,120}$/.test(path)||/^\/api\/auctions\/[a-z0-9-]{1,120}\/(bids|discount-quote)$/.test(path))return NextResponse.next();
  // Verify.et calls these exact endpoints without a Telegram session. The route
  // validates its signed raw body before accepting a test or payment event.
  if(path==='/api/payments/verify-et/webhook'||path==='/api/payments/arifpay/webhook'||path==='/telegram'||path==='/api/onboarding/contact'||path==='/admin'||path==='/admin/login'||path.startsWith('/api/admin/')||path.startsWith('/api/auth/')||path==='/api/bot/webhook')return NextResponse.next();
  const staffPage=path.startsWith('/admin/');
  let allowed=false,unavailable=false;
  try {
    // The staff layout verifies the current role and staff grant.
    allowed=staffPage?request.headers.has('cookie')&&!!await signedSessionToken(request.headers):localMiniPreview(request.headers)||!!await getMiniSession(request.headers);
  } catch { unavailable=true; }
  // The retired catalogue still returns a real 404 for signed-in players.
  if(allowed&&path==='/auctions/all'){
    const am=request.cookies.get('lowwin-language')?.value!=='en';
    return new NextResponse(`<!doctype html><html lang="${am?'am':'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>404 · LowWin</title><style>${standaloneTypography}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f2f2f7;color:#16202c;font-size:15px;line-height:1.6}main{max-width:400px;padding:32px;text-align:center}strong{color:#1e40af}h1{font-size:26px;line-height:1.4}a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;margin-top:12px;border-radius:24px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}a:focus-visible{outline:2px solid #1e40af;outline-offset:4px}</style><main><strong>LowWin</strong><h1>${am?'ይህ ገጽ አልተገኘም':'Page not found'}</h1><p>${am?'ያሉትን ጨረታዎች ከመነሻ ገጽ ይመልከቱ።':'Browse current auctions from Home.'}</p><a href="/">${am?'ወደ መነሻ ገጽ':'Return Home'}</a></main></html>`,{status:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie','X-Robots-Tag':'noindex'}});
  }
  const destination=miniReturnPath(path+request.nextUrl.search),entryUrl=new URL(staffPage?'/admin':customerLoginPath(destination),request.url);
  // An unavailable database is not an invalid login. Keep access closed, but
  // let API clients offer Retry instead of treating a live session as signed out.
  const response=allowed?NextResponse.next():path.startsWith('/api/')?NextResponse.json({error:unavailable?'Connection interrupted. Please retry.':'Log in with Telegram to continue.'},{status:unavailable?503:401}):unavailable?new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Try again | Lowwin</title><style>${standaloneTypography}</style><body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#f2f2f7;color:#16202c"><main style="padding:32px;text-align:center"><h1 style="font-size:28px">Connection busy</h1><p>Please try again.</p><a href="" style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;min-width:130px;border-radius:12px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600">Retry</a></main></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}}):NextResponse.redirect(entryUrl,{status:request.method==='GET'||request.method==='HEAD'?307:303});
  if(unavailable)response.headers.set('Retry-After','5');
  response.headers.set('Cache-Control','private, no-store, max-age=0');
  response.headers.set('Vary','Cookie');
  response.headers.set('X-Robots-Tag','noindex');
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|catalog/|icons/).*)']};
