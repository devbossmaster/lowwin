import {defineConfig} from '@playwright/test';
import isolatedProduction from './playwright.nov7.config';
const phase=process.env.CHAPA_SPEED_PHASE??'before';
if(!['before','after'].includes(phase))throw Error('Invalid speed benchmark phase');
export default defineConfig({...isolatedProduction,testDir:'./tests/chapa-speed-browser',outputDir:`test-results/chapa-speed-${phase}`,reporter:[['list']],projects:[{name:'360',use:{viewport:{width:360,height:800}}}]});
