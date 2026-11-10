import {defineConfig} from '@playwright/test';
import isolatedProduction from './playwright.nov7.config';

// The imported config enforces loopback-only _test storage, disables live
// payment integrations, and serves the optimized build over local HTTPS.
export default defineConfig({
 ...isolatedProduction,
 testDir:'./tests/nov10-browser',
 outputDir:'test-results/nov10-bid-checkout',
 reporter:[['list'],['json',{outputFile:'test-results/nov10-evidence/results.json'}]],
});
