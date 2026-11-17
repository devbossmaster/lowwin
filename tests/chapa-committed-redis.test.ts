import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {createClient} from 'redis';
import {describe,expect,it} from 'vitest';

const redisUrl=process.env.CHAPA_EVENTS_TEST_REDIS_URL?.trim();
if(redisUrl){
 const url=new URL(redisUrl);
 if(url.protocol!=='redis:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('CHAPA_EVENTS_TEST_REDIS_URL must identify an isolated loopback Redis service.');
}
type Message={kind:string;count?:number;phase?:string};
function processFixture(role:'subscriber'|'publisher',namespace:string,id:string){
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('./fixtures/chapa-committed-process.ts',import.meta.url))],{
  windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,APP_ENV:'test',DATABASE_URL:'postgresql://fixture@127.0.0.1:9/absent_test',REDIS_URL:redisUrl!,CHAPA_EVENTS_NAMESPACE:namespace,CHAPA_EVENTS_TEST_ROLE:role,CHAPA_EVENTS_TEST_CHECKOUT_ID:id},
 });
 const messages:Message[]=[],events=new EventEmitter();
 createInterface({input:child.stdout}).on('line',line=>{try{const message=JSON.parse(line) as Message;messages.push(message);events.emit('message',message)}catch{/* A malformed fixture output cannot prove delivery. */}});
 // Never echo child diagnostics containing connection configuration.
 child.stderr.resume();child.stdin.on('error',()=>events.emit('failed'));child.on('error',()=>events.emit('failed'));child.on('exit',()=>events.emit('failed'));
 const wait=(predicate:(message:Message)=>boolean,timeoutMs=6000):Promise<Message>=>{
  const found=messages.find(predicate);if(found)return Promise.resolve(found);
  return new Promise((resolve,reject)=>{
   const clear=()=>{clearTimeout(timer);events.off('message',onMessage);events.off('failed',failed)};
   const onMessage=(message:Message)=>{if(message.kind==='fatal'){failed();return}if(predicate(message)){clear();resolve(message)}};
   const failed=()=>{clear();reject(Error('Isolated Redis fixture process did not complete.'))};
   const timer=setTimeout(()=>{clear();reject(Error('Isolated Redis process message timed out.'))},timeoutMs);
   events.on('message',onMessage);events.once('failed',failed);
  });
 };
 return {child,messages,wait,send:(action:string)=>child.stdin.write(JSON.stringify({action})+'\n')};
}
async function close(child:ChildProcessWithoutNullStreams){
 if(child.exitCode!==null)return;
 await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},1500);child.once('exit',()=>{clearTimeout(timer);resolve()});child.kill()});
}

describe.skipIf(!redisUrl)('real Redis cross-process committed hints (opt-in loopback integration)',()=>{
 it('routes across processes, isolates namespaces and reconnects without duplicate listeners',async()=>{
  const probe=createClient({url:redisUrl!,disableOfflineQueue:true,socket:{connectTimeout:1000,reconnectStrategy:false}});probe.on('error',()=>{});
  let connectTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([probe.connect(),new Promise((_resolve,reject)=>{connectTimer=setTimeout(()=>{if(probe.isOpen)probe.destroy();reject(Error('Isolated Redis connection timed out.'))},1500)})]);
   expect(await probe.withCommandOptions({timeout:1000}).ping()).toBe('PONG');
  }finally{clearTimeout(connectTimer);if(probe.isOpen)probe.destroy()}
  const id=randomUUID(),prefix='chapa-integration-'+randomUUID(),children:ReturnType<typeof processFixture>[]=[];
  try{
   const owner=processFixture('subscriber',prefix+'-a',id),other=processFixture('subscriber',prefix+'-b',id),publisher=processFixture('publisher',prefix+'-a',id);children.push(owner,other,publisher);
   await Promise.all(children.map(child=>child.wait(message=>message.kind==='ready'&&message.phase==='initial')));
   publisher.send('publish');await publisher.wait(message=>message.kind==='published'&&message.count===1);await owner.wait(message=>message.kind==='signal'&&message.count===1);
   publisher.send('publish');await owner.wait(message=>message.kind==='signal'&&message.count===2);
   owner.send('drop');await owner.wait(message=>message.kind==='dropped');publisher.send('publish');await publisher.wait(message=>message.kind==='published'&&message.count===3);
   // The helper deliberately backs off a broken connection for five seconds.
   // Missing hints are recovered by owned PostgreSQL snapshots, tested elsewhere.
   await new Promise(resolve=>setTimeout(resolve,5100));expect(owner.messages.filter(message=>message.kind==='signal')).toHaveLength(2);
   owner.send('resubscribe');await owner.wait(message=>message.kind==='ready'&&message.phase==='reconnected');publisher.send('publish');await owner.wait(message=>message.kind==='signal'&&message.count===3);
   await new Promise(resolve=>setTimeout(resolve,150));
   expect(owner.messages.filter(message=>message.kind==='signal')).toHaveLength(3);expect(other.messages.some(message=>message.kind==='signal')).toBe(false);
  }finally{await Promise.all(children.map(child=>close(child.child)))}
 },20000);
});
