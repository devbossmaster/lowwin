import {createInterface} from 'node:readline';
import {publishChapaCommitted,subscribeChapaCommitted} from '../../src/modules/payments/chapa-committed';

// Dedicated process fixture: real node-redis sockets/protocol, no provider,
// database connection, financial write or externally meaningful identity.
const url=new URL(process.env.REDIS_URL??'http://invalid');
const role=process.env.CHAPA_EVENTS_TEST_ROLE,id=process.env.CHAPA_EVENTS_TEST_CHECKOUT_ID??'';
if(url.protocol!=='redis:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['subscriber','publisher'].includes(role??'')||!/^chapa-integration-[a-f0-9-]+$/.test(process.env.CHAPA_EVENTS_NAMESPACE??''))throw Error('Isolated Redis process fixture required.');
const send=(kind:string,details:Record<string,unknown>={})=>process.stdout.write(JSON.stringify({kind,...details})+'\n');
let stop:(()=>void)|undefined,count=0,published=0;
async function subscribe(phase:string){
 const previous=stop;stop=await subscribeChapaCommitted(id,()=>{send('signal',{count:++count})});previous?.();send('ready',{phase});
}
async function command(action:unknown){
 if(action==='publish'&&role==='publisher'){await publishChapaCommitted(id);send('published',{count:++published})}
 else if(action==='drop'&&role==='subscriber'){
  // Exercise the helper's real error/socket shutdown path without killing any
  // other Redis client's connection or altering a shared broker's state.
  const state=(globalThis as unknown as {lowwinChapaCommitted?:{subscriber?:{client:{emit:(event:string,error:Error)=>void}}}}).lowwinChapaCommitted;
  state?.subscriber?.client.emit('error',Error('Controlled isolated TEST socket drop.'));send('dropped');
 }else if(action==='resubscribe'&&role==='subscriber')await subscribe('reconnected');
 else if(action==='stop'){stop?.();process.exit(0)}
}
try{
 if(role==='subscriber')await subscribe('initial');else send('ready',{phase:'initial'});
 const input=createInterface({input:process.stdin});let queued=Promise.resolve();
 input.on('line',line=>{queued=queued.then(async()=>{let value:unknown;try{value=JSON.parse(line)}catch{return}await command((value as {action?:unknown})?.action)}).catch(()=>{send('fatal');process.exitCode=1;process.exit()})});
 process.once('SIGTERM',()=>{stop?.();process.exit(0)});
}catch{send('fatal');process.exit(1)}
