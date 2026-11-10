import {defineConfig} from '@playwright/test';
import isolatedProduction from './playwright.nov7.config';
export default defineConfig({...isolatedProduction,testDir:'./tests/nov10-winners-browser',outputDir:'test-results/nov10-winners-traces',projects:isolatedProduction.projects?.map(project=>project.name==='430'?{...project,testIgnore:'**/header.spec.ts'}:project),reporter:[['list'],['json',{outputFile:'test-results/nov10-winners/results.json'}]]});
