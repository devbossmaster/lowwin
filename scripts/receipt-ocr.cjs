// Private stdin/stdout protocol. Packaged language data, no network or receipt files.
const {createWorker,PSM}=require('tesseract.js');
const {join}=require('node:path');
const eng=require('@tesseract.js-data/eng');
(async()=>{
 const chunks=[];let size=0,worker,image;
 try{
  // A validated 12 MP image can expand to a 48 MB RGBA PNG at original quality.
  for await(const c of process.stdin){size+=c.length;if(size>50*1024*1024)throw Error();chunks.push(c)}
  image=Buffer.concat(chunks);
  worker=await createWorker('eng',1,{langPath:join(eng.langPath,'..','4.0.0_best_int'),cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
  const read=async(bytes,mode)=>{
   await worker.setParameters({tessedit_pageseg_mode:mode});
   const {data}=await worker.recognize(bytes,{},{blocks:true});
   const words=(data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words))).filter(w=>/[0-9]/.test(w.text)).slice(0,50).map(w=>({text:w.text.slice(0,100),confidence:w.confidence}));
   return {text:data.text.slice(0,4000),confidence:data.confidence,words};
  };
  const first=await read(image,PSM.SPARSE_TEXT);
  const second=await read(image,PSM.AUTO);
  process.stdout.write(JSON.stringify({passes:[first,second]}));
 }finally{image?.fill(0);for(const c of chunks)c.fill(0);if(worker)await worker.terminate()}
})().catch(()=>{process.exitCode=1});
