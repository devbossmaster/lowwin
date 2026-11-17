import {createHash} from 'node:crypto';
import {createClient} from 'redis';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const makeClient=(url:string)=>createClient({url,disableOfflineQueue:true,socket:{connectTimeout:500,reconnectStrategy:false}});
type Client=ReturnType<typeof makeClient>;
type Listener=()=>void;
type Connection={url:string;channel:string;client:Client;connecting?:Promise<void>;subscribing?:Promise<void>;retryAt:number;subscribed:boolean;failed:boolean};
type State={publisher?:Connection;subscriber?:Connection;listeners:Map<string,Set<Listener>>};
const shared=globalThis as unknown as {lowwinChapaCommitted?:State};
const state=():State=>shared.lowwinChapaCommitted??={listeners:new Map()};

/** Separate from the public cache. Redis carries only lossy, opaque wake-up
 * hints: no balances, payment state, session identifiers or durable evidence. */
export function chapaCommittedChannel(){
 const db=new URL(process.env.DATABASE_URL??'postgresql://unconfigured/local');
 // Different web/worker database roles must reach the same deployment channel.
 // Explicit deployment namespace also permits different DB pooler hostnames.
 const namespace=process.env.CHAPA_EVENTS_NAMESPACE?.trim();
 const scope=namespace?[process.env.APP_ENV,namespace].join('|'):[process.env.APP_ENV,process.env.REDIS_CACHE_NAMESPACE??'lowwin',db.host,db.pathname].join('|');
 return `lowwin:payments:committed:v1:${createHash('sha256').update(scope).digest('hex').slice(0,24)}`;
}
function connection(kind:'publisher'|'subscriber'){
 const url=process.env.REDIS_URL?.trim();if(!url)return;
 const parsed=new URL(url);
 if(!['redis:','rediss:'].includes(parsed.protocol)||(process.env.APP_ENV==='production'&&!parsed.password))return;
 const current=state(),channel=chapaCommittedChannel();let value=current[kind];
 if(!value||value.url!==url||value.channel!==channel||value.failed&&value.retryAt<=Date.now()){
  if(value?.client.isOpen)value.client.destroy();
  const client=makeClient(url);value={url,channel,client,retryAt:0,subscribed:false,failed:false};current[kind]=value;
  const owned=value;
  client.on('error',()=>unavailable(owned));
 }
 return value;
}
function unavailable(value:Connection){
 value.failed=true;value.subscribed=false;value.retryAt=Date.now()+5000;
 if(value.client.isOpen)value.client.destroy();
}
async function bounded<T>(value:Connection,operation:()=>Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([operation(),new Promise<T>((_resolve,reject)=>{
   timer=setTimeout(()=>{unavailable(value);reject(Error('Payment signal broker unavailable.'))},500);
  })]);
 }finally{clearTimeout(timer)}
}
async function ready(value:Connection){
 if(value.failed||value.retryAt>Date.now())return false;
 try{
  if(!value.client.isReady){
   value.connecting??=bounded(value,()=>value.client.connect()).then(()=>{}).finally(()=>{value.connecting=undefined});
   await value.connecting;
  }
  return value.client.isReady;
 }catch{unavailable(value);return false}
}

/** Call only after the database write/transaction has committed. A lost signal
 * cannot lose a payment: reconnect/resume reads and polling use PostgreSQL. */
export async function publishChapaCommitted(checkoutId:string):Promise<void>{
 if(!UUID.test(checkoutId))return;
 let owned:Connection|undefined;
 try{
  const value=connection('publisher');owned=value;if(!value||!await ready(value))return;
  await bounded(value,()=>value.client.withCommandOptions({timeout:500}).publish(value.channel,JSON.stringify({v:1,id:checkoutId.toLowerCase()})));
 }catch{
  // A failed older publication must not close a replacement connection after
  // a deployment namespace/credential rotation changed the shared state.
  if(owned)unavailable(owned);
  // A broker outage must not change a committed result or expose its details.
 }
}

/** One subscriber socket per web process, shared by all owned SSE streams.
 * Treat every Redis message as untrusted; consumers always re-read the owner. */
export async function subscribeChapaCommitted(checkoutId:string,listener:Listener):Promise<()=>void>{
 const current=state(),key=checkoutId.toLowerCase();
 if(!UUID.test(key)||[...current.listeners.values()].reduce((count,set)=>count+set.size,0)>=512)return ()=>{};
 const listeners=current.listeners.get(key)??new Set<Listener>();listeners.add(listener);current.listeners.set(key,listeners);
 const cleanup=()=>{listeners.delete(listener);if(!listeners.size&&current.listeners.get(key)===listeners)current.listeners.delete(key)};
 try{
  const value=connection('subscriber');
  if(value&&await ready(value)&&!value.subscribed){
   // Share actual subscription completion, closing the initial-read race for
   // every stream that joins while the first subscribe command is in flight.
   // node-redis's Pub/Sub queue does not inherit commandOptions.timeout, so
   // explicitly bound this await and destroy a stalled subscriber connection.
   value.subscribing??=bounded(value,()=>value.client.subscribe(value.channel,raw=>{
    if(Buffer.byteLength(raw)>100)return;
    try{
     const signal=JSON.parse(raw) as {v?:unknown;id?:unknown};
     if(signal.v!==1||typeof signal.id!=='string'||!UUID.test(signal.id)||Object.keys(signal).some(key=>!['v','id'].includes(key)))return;
     for(const notify of state().listeners.get(signal.id.toLowerCase())??[]){try{notify()}catch{/* A closed stream cannot break another owner. */}}
    }catch{/* Invalid broker hints are ignored. */}
   })).then(()=>{value.subscribed=true}).catch(()=>unavailable(value)).finally(()=>{value.subscribing=undefined});
   await value.subscribing;
  }
 }catch{/* Polling and connection snapshot recovery remain available. */}
 return cleanup;
}
