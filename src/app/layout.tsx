import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Lowwin — A little different wins', template: '%s · Lowwin' }, description: 'The lowest unique ETB bid wins. Discover a different way to bid with Lowwin.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#FFFFFF' };
export const dynamic = 'force-dynamic';
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Telegram's beforeInteractive SDK owns viewport CSS variables on <html>.
  return <html lang="en" suppressHydrationWarning><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
