import type { NextConfig } from 'next';
const config: NextConfig = {
  async redirects(){return [{source:'/:path*',has:[{type:'host' as const,value:'www.lowwin.shop'}],destination:'https://lowwin.shop/:path*',permanent:true}]},
  allowedDevOrigins: ['unpurged-nickolas-unlevelly.ngrok-free.dev'],
  // Isolate browser-test servers from the owner's running development app.
  distDir: process.env.LOWIN_UI_TEST_MODE === 'payments' ? '.next-ui-payments' : process.env.LOWIN_UI_TEST_MODE === 'local' ? '.next-ui-local' : process.env.LOWIN_UI_TEST_MODE === 'tunnel' ? '.next-ui-tunnel' : '.next',
  typescript: { tsconfigPath: process.env.LOWIN_UI_TEST_MODE ? 'tsconfig.ui-tests.json' : 'tsconfig.json' },
  outputFileTracingIncludes: {'/api/wallet/scan':['./scripts/receipt-ocr.cjs','./node_modules/tesseract.js/**','./node_modules/tesseract.js-core/**','./node_modules/@tesseract.js-data/eng/**']},
  poweredByHeader: false, devIndicators: false, serverExternalPackages: ['@prisma/client','tesseract.js','@tesseract.js-data/eng'], async headers() { return [{ source: '/(.*)', headers: [{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'}] },...['/telegram','/admin/:path*','/profile/:path*','/my-bids','/wallet'].map(source=>({source,headers:[{key:'Cache-Control',value:'private, no-store, max-age=0'},{key:'Vary',value:'Cookie'},{key:'X-Robots-Tag',value:'noindex'}]}))]; } };
export default config;
