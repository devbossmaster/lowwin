import type { Metadata, Viewport } from 'next';
import {cookies} from 'next/headers';
import {MiniLocaleProvider,MiniPhrase} from '@/components/mini-locale';
import './globals.css';
import '@/components/mini-redesign.css';
export const metadata: Metadata = { title: { default: 'Lowwin — A little different wins', template: '%s · Lowwin' }, description: 'The lowest unique ETB bid wins. Discover a different way to bid with Lowwin.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#FFFFFF' };
export const dynamic = 'force-dynamic';
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Telegram's beforeInteractive SDK owns viewport CSS variables on <html>.
  const language=(await cookies()).get('lowwin-language')?.value==='en'?'en':'am';
  return <html lang={language} suppressHydrationWarning><body><MiniLocaleProvider initialLanguage={language}><a className="skip-link" href="#main"><MiniPhrase en="Skip to content" am="ወደ ዋናው ይዘት ይሂዱ"/></a>{children}</MiniLocaleProvider></body></html>;
}
