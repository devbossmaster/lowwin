import {defineConfig} from '@playwright/test';
import {ENGLISH_UI_STATE} from './tests/helpers';
// Start the isolated local preview on 3112 before running this focused suite.
export default defineConfig({testDir:'./tests/header-browser',workers:1,timeout:60000,reporter:'list',use:{storageState:ENGLISH_UI_STATE,baseURL:'http://localhost:3112',browserName:'chromium',channel:'chrome'},projects:[{name:'360',use:{viewport:{width:360,height:800}}},{name:'430',use:{viewport:{width:430,height:932}}},{name:'desktop',use:{viewport:{width:1280,height:900}}}]});
