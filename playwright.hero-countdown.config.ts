import {defineConfig} from '@playwright/test';
import base from './playwright.nov7.config';
export default defineConfig({...base,testDir:'./tests/hero-countdown-browser',outputDir:'test-results/hero-countdown',timeout:90000,expect:{timeout:20000},reporter:[['list'],['json',{outputFile:'test-results/hero-countdown/results.json'}]],projects:[320,430,1280].map(width=>({name:String(width),use:{viewport:{width,height:width===1280?900:932}}}))});
