import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';

export default defineConfig({...base,testDir:'./tests/telegram-website-browser',outputDir:'test-results/telegram-website-browser',timeout:60000,workers:2,expect:{timeout:15000},reporter:[['list']],use:{...base.use,actionTimeout:15000,navigationTimeout:45000},projects:[320,360,430,768,1024,1280].map(width=>({name:String(width),use:{viewport:{width,height:width>=768?1000:850}}}))});
