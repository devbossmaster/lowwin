// Test-only direct child: no shell/next-dev supervisor tree to strand on Windows.
import {once} from 'node:events';
const db=new URL(process.env.DATABASE_URL??'');
if(process.env.APP_ENV!=='local'||!['127.0.0.1','localhost'].includes(db.hostname)||!db.pathname.endsWith('_test')||!process.send)throw Error('Managed disposable loopback test process required');
const [kind,port]=process.argv.slice(2);
let stop;
if(kind==='next'){
 const production=process.env.LOWWIN_BROWSER_PRODUCTION==='1';
 if(production||process.env.LOWWIN_BROWSER_WEBPACK==='1')delete process.env.TURBOPACK;
 else process.env.TURBOPACK='1';
 if(!production)process.env.__NEXT_DEV_SERVER='1';
 const {startServer}=await import('next/dist/server/lib/start-server.js');
 await startServer({dir:process.cwd(),hostname:'127.0.0.1',port:Number(port),isDev:!production,allowRetry:false});
 // Use the same shutdown handler as Next's own server worker (exit 143).
 stop=()=>process.emit('SIGTERM','SIGTERM');
}else{
 const entry=kind==='email'?'./email-sink.ts':kind==='payments'?'./payment-test-sink.ts':null;
 if(!entry)throw Error('Unknown fixture server');
 const {server}=await import(entry);
 if(!server.listening)await once(server,'listening');
 stop=()=>{server.close(()=>process.exit(0));server.closeAllConnections()};
}
let stopping=false;
const shutdown=()=>{if(stopping)return;stopping=true;stop()};
process.on('message',message=>{if(message==='shutdown')shutdown()});
process.on('disconnect',shutdown);
process.send({ready:true});
