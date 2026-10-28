import {spawn} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const commands={web:['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3210'],bot:['--import','tsx','scripts/worker.ts'],auctions:['--import','tsx','scripts/auction-worker.ts'],notifications:['--import','tsx','scripts/notification-worker.ts'],chapa:['--import','tsx','scripts/chapa-worker.ts']};
export function serviceCommand(name){
 if(!Object.hasOwn(commands,name))throw Error('Choose web, bot, auctions, notifications, or chapa');
 return [...commands[name]];
}
// Resolve the atomic current-release symlink before checking the entrypoint.
// Importing the allowlist for validation must never launch a runtime service.
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const child=spawn(process.execPath,serviceCommand(process.argv[2]),{stdio:'inherit',env:process.env});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('error',()=>{console.error('Lowwin service failed to start');process.exitCode=1});
 child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGTERM'?0:1)});
}
