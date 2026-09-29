import {spawn} from 'node:child_process';
const commands={web:['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3210'],bot:['--import','tsx','scripts/worker.ts'],auctions:['--import','tsx','scripts/auction-worker.ts'],notifications:['--import','tsx','scripts/notification-worker.ts']};
const args=commands[process.argv[2]];if(!args)throw Error('Choose web, bot, auctions, or notifications');
const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Lowwin service failed to start');process.exitCode=1});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGTERM'?0:1)});
