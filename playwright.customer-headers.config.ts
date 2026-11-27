import {defineConfig} from '@playwright/test';
import base from './playwright.chapa.config';
export default defineConfig({
 ...base,
 projects:base.projects?.filter(project=>project.name!=='desktop').map(project=>({...project,testMatch:'**/customer-headers.spec.ts'})),
 outputDir:'test-results/customer-headers',
 reporter:[['list'],['json',{outputFile:'test-results/customer-headers/results.json'}]],
});
