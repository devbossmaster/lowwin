/** Offline file generation only: no database connection or production write. */
import fs from 'node:fs';
import path from 'node:path';
import {prepareCatalogPurge,writeCatalogPurge} from './catalog-purge';
const args=process.argv.slice(2),get=(key:string)=>args.includes(key)?args[args.indexOf(key)+1]:undefined;
const input=get('--inventory'),output=get('--output'),review=get('--review');
if(!input||!output)throw Error('Provide --inventory and an ignored .local --output folder');
if(!path.resolve(output).startsWith(path.resolve('.local')+path.sep))throw Error('Private catalog review must remain in .local');
const config=prepareCatalogPurge(JSON.parse(fs.readFileSync(input,'utf8')),review?JSON.parse(fs.readFileSync(review,'utf8')):undefined);
writeCatalogPurge(config,output);
console.log(JSON.stringify({mode:'OFFLINE PREPARATION ONLY',runId:config.runId,manifestHash:config.manifestHash,tables:config.tables.map((t:{name:string;count:number})=>({name:t.name,rows:t.count})),approval:config.executionAcknowledgement}));
