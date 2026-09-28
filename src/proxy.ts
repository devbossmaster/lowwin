import {NextRequest,NextResponse} from 'next/server';
import {getMiniSession,localMiniPreview} from '@/modules/auth/mini-access';

export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  // Public onboarding artwork must load before a Telegram session exists.
  // Keep this exact allowlist separate from all protected Mini App data.
  if(['/logo.png','/fonts/NotoSansEthiopic-Bold.ttf'].includes(path))return NextResponse.next();
  if(path==='/telegram'||path==='/api/onboarding/contact'||path.startsWith('/admin')||path.startsWith('/api/admin/')||path.startsWith('/api/auth/')||path.startsWith('/api/bot/'))return NextResponse.next();
  let allowed=false;
  try { allowed=localMiniPreview(request.headers)||!!await getMiniSession(request.headers); } catch { /* fail closed, including missing migrations */ }
  const response=allowed?NextResponse.next():path.startsWith('/api/')?NextResponse.json({error:'Open Lowwin through the Telegram bot.'},{status:401}):NextResponse.redirect(new URL('/telegram',request.url));
  response.headers.set('Cache-Control','private, no-store, max-age=0');
  response.headers.set('Vary','Cookie');
  response.headers.set('X-Robots-Tag','noindex');
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|catalog/|icons/).*)']};
