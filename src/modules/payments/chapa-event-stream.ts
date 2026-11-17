type Options<T>={
 initial:T;
 expiresAt:number;
 signal:AbortSignal;
 authorized:()=>Promise<boolean>;
 read:()=>Promise<T>;
 subscribe:(notify:()=>void)=>Promise<()=>void>;
};
const encoder=new TextEncoder();
export const chapaEventStreamHeaders={
 'Content-Type':'text/event-stream; charset=utf-8',
 'Cache-Control':'private, no-store, max-age=0, no-transform',
 Vary:'Cookie',
 'X-Accel-Buffering':'no',
 'X-Content-Type-Options':'nosniff',
};

/** The broker can only request an owned database read. Session revocation is
 * checked before every DTO and heartbeat; short streams also renew cookies. */
export function createChapaEventStream<T extends {id:string}>(options:Options<T>){
 let closed=false,reading=false,dirty=false,controller:ReadableStreamDefaultController<Uint8Array>;
 let unsubscribe:(()=>void)|undefined,heartbeat:ReturnType<typeof setInterval>|undefined,lifetime:ReturnType<typeof setTimeout>|undefined;
 const close=()=>{
  if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);unsubscribe?.();options.signal.removeEventListener('abort',close);
  try{controller.close()}catch{/* Reader cancellation already closed the stream. */}
 };
 const send=(event:string,value:unknown)=>{
  if(closed)return;
  // Do not accumulate private snapshots for a stalled/closed browser.
  if(controller.desiredSize!==null&&controller.desiredSize<=0){close();return}
  try{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`))}catch{close()}
 };
 const read=async()=>{
  if(closed)return;dirty=true;if(reading)return;reading=true;
  try{
   while(dirty&&!closed){
    dirty=false;
    if(!await options.authorized()){send('authorization',{});close();break}
    const snapshot=await options.read();
    if(!closed)send('checkout',{checkout:snapshot});
   }
  }catch{close()}finally{reading=false}
 };
 return new ReadableStream<Uint8Array>({
  start(value){
   controller=value;
   if(options.signal.aborted){close();return}
   options.signal.addEventListener('abort',close,{once:true});
   // Flush headers/first bytes before waiting for the optional Redis broker.
   controller.enqueue(encoder.encode('retry: 3000\n: connected\n\n'));
   send('checkout',{checkout:options.initial});
   lifetime=setTimeout(close,Math.max(0,Math.min(55000,options.expiresAt-Date.now())));
   heartbeat=setInterval(()=>{
    if(closed||reading)return;
    reading=true;
    void options.authorized().then(valid=>{
     if(closed)return;
     if(!valid){send('authorization',{});close();return}
     if(controller.desiredSize!==null&&controller.desiredSize<=0){close();return}
     controller.enqueue(encoder.encode(': heartbeat\n\n'));
    }).catch(close).finally(()=>{reading=false;if(dirty&&!closed)void read()});
   },15000);
   void options.subscribe(()=>void read()).then(stop=>{
    if(closed){stop();return}unsubscribe=stop;
    // Covers commits between the initial read and pub/sub subscription. It
    // also provides durable recovery when Last-Event-ID was missed or evicted.
    void read();
   }).catch(close);
  },
  cancel(){close()},
 },{highWaterMark:128*1024,size:chunk=>chunk.byteLength});
}
