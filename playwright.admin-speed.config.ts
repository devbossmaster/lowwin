import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';
export default defineConfig({...base,testDir:'./tests/admin-speed-browser',outputDir:'test-results/admin-speed/traces',projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}}],reporter:[['list'],['json',{outputFile:'test-results/admin-speed/results.json'}]]});
