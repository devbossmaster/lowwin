import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/refund-notice-watch-browser',timeout:30000,workers:1,use:{browserName:'chromium',channel:process.env.PLAYWRIGHT_CHANNEL??(process.platform==='win32'?'chrome':undefined),headless:true,viewport:{width:390,height:844}},outputDir:'test-results/refund-notice-watch'});
