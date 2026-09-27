// Private stdin/stdout protocol. No files, network language downloads or logs.
const {createWorker}=require('tesseract.js');
const {join}=require('node:path');
const eng=require('@tesseract.js-data/eng');
(async()=>{const chunks=[];let size=0;for await(const c of process.stdin){size+=c.length;if(size>20*1024*1024)throw Error();chunks.push(c)}let worker;try{worker=await createWorker('eng',1,{langPath:join(eng.langPath,'..','4.0.0_best_int'),cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});const {data}=await worker.recognize(Buffer.concat(chunks));process.stdout.write(JSON.stringify({text:data.text.slice(0,4000),confidence:data.confidence}))}finally{for(const c of chunks)c.fill(0);if(worker)await worker.terminate()}})().catch(()=>{process.exitCode=1});
