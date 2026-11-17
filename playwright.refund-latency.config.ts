import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';
export default defineConfig({...base,testDir:'./tests/refund-ui-browser',outputDir:'test-results/refund-ui',workers:1,reporter:[['list'],['json',{outputFile:'test-results/refund-ui/results.json'}]],projects:[{name:'430',use:{viewport:{width:430,height:932}}}]});
