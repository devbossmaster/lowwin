import {defineConfig} from '@playwright/test';
import isolatedProduction from './playwright.nov7.config';
export default defineConfig({...isolatedProduction,testDir:'./tests/home-polish-browser',outputDir:'test-results/home-polish/traces',projects:[{name:'mobile'}],reporter:[['list'],['json',{outputFile:'test-results/home-polish/results.json'}]]});
