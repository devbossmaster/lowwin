import type { Metadata, Viewport } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './globals.css';
import { TelegramProvider } from '@/components/telegram-provider';
import { AppShell } from '@/components/app-shell';
import { assertLocalDevelopment } from '@/lib/env';
export const metadata: Metadata = { title: { default: 'Lowin — A little different wins', template: '%s · Lowin' }, description: 'The lowest unique point bid wins. Discover a different way to bid with Lowin.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F7F7F2' };
export const dynamic = 'force-dynamic';
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let devEnabled = false;
  try { assertLocalDevelopment('identity'); devEnabled = true; } catch { /* Production never exposes the test action. */ }
  const username = process.env.TELEGRAM_BOT_USERNAME;
  const botUrl = username && /^[A-Za-z0-9_]+bot$/i.test(username) ? `https://t.me/${username}?start=lowin` : null;
  // Telegram's beforeInteractive SDK owns viewport CSS variables on <html>.
  return <html lang="en" suppressHydrationWarning><body><a className="skip-link" href="#main">Skip to content</a><TelegramProvider devEnabled={devEnabled} botUrl={botUrl}><AppShell>{children}</AppShell></TelegramProvider></body></html>;
}
