import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';

export default defineConfig({...base,testDir:'./tests/checkout-v1-browser',outputDir:'test-results/checkout-v1',timeout:90000,expect:{timeout:15000},reporter:[['list']],use:{...base.use,actionTimeout:20000,navigationTimeout:45000},projects:[320,360,430].map(width=>({name:String(width),use:{viewport:{width,height:width===430?932:800}}}))});
