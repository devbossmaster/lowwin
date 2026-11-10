import {defineConfig} from '@playwright/test';
import isolatedProduction from './playwright.nov7.config';
const stage=process.env.CARD_DENSITY_STAGE??'after';
if(!['before','after'].includes(stage))throw Error('Invalid card density stage');
export default defineConfig({...isolatedProduction,testDir:'./tests/auction-card-density-browser',outputDir:`test-results/auction-card-density/traces-${stage}`,reporter:[['list'],['json',{outputFile:`test-results/auction-card-density/results-${stage}.json`}]],projects:[320,360,430].map(width=>({name:String(width),use:{viewport:{width,height:900}}}))});
