import type { Metadata, Viewport } from 'next';
import {cookies,headers} from 'next/headers';
import {MiniLocaleProvider,MiniPhrase} from '@/components/mini-locale';
import {MiniIdentityBoundary} from '@/components/mini-identity-boundary';
import {assertLocalIdentitySurface} from '@/modules/auth/local-identity';
import {LOWWIN_ICON_SRC} from '@/lib/brand';
import './globals.css';
import '@/components/mini-redesign.css';
import '@/components/lowwin-brand.css';
import '@/components/browser-responsive.css';
export const metadata: Metadata = { title: { default: 'LowWin — A little different wins', template: '%s · LowWin' }, description: 'The lowest unique ETB bid wins. Discover a different way to bid with LowWin.',icons:{icon:LOWWIN_ICON_SRC,apple:LOWWIN_ICON_SRC} };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F2F2F7' };
export const dynamic = 'force-dynamic';
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language=(await cookies()).get('lowwin-language')?.value==='en'?'en':'am';
  let devEnabled=false;try{assertLocalIdentitySurface(new Headers(await headers()));devEnabled=true}catch{}
  const name=process.env.TELEGRAM_BOT_USERNAME,botUrl=name&&/^[A-Za-z0-9_]+bot$/i.test(name)?`https://t.me/${name}?start=lowin`:null;
  return <html lang={language} suppressHydrationWarning><body><MiniLocaleProvider initialLanguage={language}><a className="skip-link" href="#main"><MiniPhrase en="Skip to content" am="ወደ ዋናው ይዘት ይሂዱ"/></a><MiniIdentityBoundary devEnabled={devEnabled} botUrl={botUrl}>{children}</MiniIdentityBoundary></MiniLocaleProvider></body></html>;
}
