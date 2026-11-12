import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';

export default defineConfig({...base,testDir:'./tests/reference-bid-browser',outputDir:'test-results/reference-bid',timeout:60000,expect:{timeout:15000},reporter:[['list']],use:{...base.use,actionTimeout:15000,navigationTimeout:45000},projects:[320,360,430].map(width=>({name:String(width),use:{viewport:{width,height:width===430?932:800}}}))});
