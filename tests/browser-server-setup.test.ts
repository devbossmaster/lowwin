import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {describe,it,expect} from 'vitest';
import {stopOwnedServer} from './browser-server-setup';

// Exercise real owned processes, including a server that refuses graceful shutdown.
async function fixture(ignoreShutdown=false){
 const script=`const s=require('node:http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>process.send(s.address().port));process.on('message',()=>{if(!${ignoreShutdown})s.close(()=>process.exit(0))});`;
 const child=spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 const owned={child,spec:{kind:'email' as const,port:0},closed:false,exit:Promise.resolve<number|null>(null)};
 owned.exit=new Promise(resolve=>child.once('exit',code=>{owned.closed=true;resolve(code)}));
 const [port]=await once(child,'message');owned.spec.port=port;
 return owned;
}
describe('browser fixture shutdown',()=>{
 it('waits for graceful exit and confirms that the listening port is released',async()=>{
  const owned=await fixture();try{await stopOwnedServer(owned);expect(owned.closed).toBe(true)}finally{if(!owned.closed)owned.child.kill()}
 });
 it('fails within a bounded time when a fixture ignores shutdown',async()=>{
  const owned=await fixture(true);try{await expect(stopOwnedServer(owned,100)).rejects.toThrow('did not stop');await owned.exit;expect(owned.closed).toBe(true)}finally{if(!owned.closed)owned.child.kill()}
 });
 it('does not report an unexpected pre-teardown exit as success',async()=>{
  const owned=await fixture();owned.child.kill();await owned.exit;
  await expect(stopOwnedServer(owned)).rejects.toThrow('exited before teardown');
 });
});
