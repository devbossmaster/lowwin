import type { Metadata, Viewport } from 'next';
import {cookies,headers} from 'next/headers';
import {MiniLocaleProvider,MiniPhrase} from '@/components/mini-locale';
import {MiniIdentityBoundary} from '@/components/mini-identity-boundary';
import {assertLocalIdentitySurface} from '@/modules/auth/local-identity';
import {browserDocumentAccountBootstrap} from '@/modules/auth/customer-page';
import {browserLoginConfig,TELEGRAM_BROWSER_RESTORE_COOKIE} from '@/modules/auth/telegram-login';
import {LOWWIN_BODY_FONT_SRC,LOWWIN_DISPLAY_FONT_SRC,LOWWIN_ETHIOPIC_FONT_SRC,LOWWIN_ICON_SRC} from '@/lib/brand';
import './globals.css';
import '@/components/mini-redesign.css';
import '@/components/lowwin-brand.css';
export const metadata: Metadata = { title: { default: 'LowWin — A little different wins', template: '%s · LowWin' }, description: 'The lowest unique ETB bid wins. Discover a different way to bid with LowWin.',icons:{icon:LOWWIN_ICON_SRC,apple:LOWWIN_ICON_SRC} };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F2F2F7' };
export const dynamic = 'force-dynamic';
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [requestCookies,requestHeaders]=await Promise.all([cookies(),headers()]);
  const language=requestCookies.get('lowwin-language')?.value==='en'?'en':'am';
  const documentHeaders=new Headers(requestHeaders);
  let devEnabled=false;try{assertLocalIdentitySurface(documentHeaders);devEnabled=true}catch{}
  // A cookie-free document can present the guest UI immediately. A recent
  // website callback instead streams its verified account, and Mini App
  // launch still takes precedence over the document's browser hint.
  const initialAccount=!devEnabled?browserDocumentAccountBootstrap(documentHeaders,requestCookies.get(TELEGRAM_BROWSER_RESTORE_COOKIE)?.value==='1'):undefined;
  const name=process.env.TELEGRAM_BOT_USERNAME,botUrl=name&&/^[A-Za-z0-9_]+bot$/i.test(name)?`https://t.me/${name}?start=lowin`:null;
  const headingFont=language==='am'?LOWWIN_ETHIOPIC_FONT_SRC:LOWWIN_DISPLAY_FONT_SRC;
  return <html lang={language} suppressHydrationWarning><head><link rel="preload" as="font" href={headingFont} type="font/woff2" crossOrigin="anonymous"/><link rel="preload" as="font" href={LOWWIN_BODY_FONT_SRC} type="font/woff2" crossOrigin="anonymous"/></head><body><MiniLocaleProvider initialLanguage={language}><a className="skip-link" href="#main"><MiniPhrase en="Skip to content" am="ወደ ዋናው ይዘት ይሂዱ"/></a><MiniIdentityBoundary devEnabled={devEnabled} botUrl={botUrl} browserLogin={browserLoginConfig()} initialAccount={initialAccount}>{children}</MiniIdentityBoundary></MiniLocaleProvider></body></html>;
}
