import {defineConfig} from '@playwright/test';
import isolatedProduction from './playwright.nov7.config';
export default defineConfig({...isolatedProduction,testDir:'./tests/wallet-sheet-browser',outputDir:'test-results/wallet-sheet/traces',reporter:[['list'],['json',{outputFile:'test-results/wallet-sheet/results.json'}]],projects:[320,360,430].map(width=>({name:String(width),use:{viewport:{width,height:850}}}))});
