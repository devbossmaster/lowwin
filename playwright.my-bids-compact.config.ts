import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';

export default defineConfig({...base,testDir:'./tests/my-bids-compact-browser',outputDir:'test-results/my-bids-compact',reporter:[['list']],projects:[320,360,430].map(width=>({name:String(width),use:{viewport:{width,height:width===430?932:800}}}))});
