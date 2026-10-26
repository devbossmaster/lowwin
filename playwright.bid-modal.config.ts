import {defineConfig} from '@playwright/test';
import base from './playwright.chapa.config';
export default defineConfig({...base,testMatch:'bid-modal-polish.spec.ts',outputDir:'test-results/bid-modal-polish',reporter:[['list'],['json',{outputFile:'test-results/bid-modal-polish/results.json'}]]});
