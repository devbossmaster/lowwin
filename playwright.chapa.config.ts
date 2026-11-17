import {defineConfig} from '@playwright/test';
import base from './playwright.checkout-v2-inline.config';

// Payment CI follows the shipped v2 Inline entry points. Historical orders
// still have explicit hosted return, Direct recovery and account isolation
// checks; they must never be tested by starting a retired Direct checkout.
const mobile=[
 '**/checkout-v2-inline-browser/**/*.spec.ts',
 '**/reference-bid-browser/payment-status.spec.ts',
 '**/chapa-browser/recovery.spec.ts',
 '**/chapa-browser/return-ui.spec.ts',
 '**/chapa-browser/v2-errors.spec.ts',
 '**/nov7-browser/public-ui.spec.ts',
 '**/nov7-browser/registration.spec.ts',
 '**/nov7-browser/quick-navigation.spec.ts',
];
export default defineConfig({
 ...base,testDir:'./tests',outputDir:'test-results/chapa-ui',
 timeout:90000,expect:{timeout:15000},
 reporter:[['list'],['json',{outputFile:'test-results/chapa-ui/results.json'}]],
 projects:[
  ...[360,430].map(width=>({name:String(width),testMatch:mobile,use:{viewport:{width,height:width===430?932:800}}})),
  {name:'desktop',testMatch:'**/chapa-browser/winner-banner.spec.ts',use:{viewport:{width:1280,height:900}}},
 ],
});
