import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';
export default defineConfig({...base,testDir:'./tests/transactions-browser',outputDir:'test-results/transactions-traces',use:{...base.use,trace:'on'},projects:[{name:'360',use:{viewport:{width:360,height:800}}}],reporter:[['list']]});
