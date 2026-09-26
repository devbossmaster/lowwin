import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader: false, devIndicators: false, serverExternalPackages: ['@prisma/client'], async headers() { return [{ source: '/(.*)', headers: [{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'}] }]; } };
export default config;
