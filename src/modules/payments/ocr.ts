import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {candidate,PaymentError,type Bank} from './provider';
export const RECEIPT_LIMIT=5*1024*1024;
export async function cleanReceipt(bytes:Buffer,mime:string){
 if(!bytes.length||bytes.length>RECEIPT_LIMIT)throw new PaymentError(413,'Use a receipt image smaller than 5 MB.');
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!({ 'image/png':png,'image/jpeg':jpeg,'image/webp':webp} as Record<string,boolean>)[mime])throw new PaymentError(422,'Use a static PNG, JPEG or WebP receipt.');
 try{const decoder=sharp(bytes,{limitInputPixels:12000000,failOn:'warning',animated:true}),meta=await decoder.metadata();if((meta.pages??1)!==1||!meta.width||!meta.height||meta.width>6000||meta.height>6000||png&&bytes.includes(Buffer.from('acTL')))throw Error();return await decoder.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{throw new PaymentError(422,'Image cannot be safely decoded. Use a smaller static receipt or enter the reference.')}
}
let active=false;
type OcrResult={text:string;confidence:number;words?:{text:string;confidence:number}[]};
export function extractedReference(result:OcrResult,bank:Bank){
 if(typeof result.text!=='string'||typeof result.confidence!=='number'||!Number.isFinite(result.confidence))throw new PaymentError(422,'Scan is uncertain. Enter the reference manually.');
 const reference=candidate(bank,result.text);
 // Unrelated artwork and Amharic text must not outweigh a clearly read reference.
 const words=Array.isArray(result.words)?result.words.filter(w=>typeof w.text==='string'&&w.text.toUpperCase().split(/[^A-Z0-9]+/).includes(reference)):[];
 const confidence=Math.max(result.confidence,...words.map(w=>Number.isFinite(w.confidence)?w.confidence:0));
 if(confidence<75)throw new PaymentError(422,'Scan is uncertain. Enter the reference manually.');
 return {reference,reviewRequired:true};
}
export async function scanReceipt(bytes:Buffer,mime:string,bank:Bank){
 if(process.env.RECEIPT_OCR!=='tesseract')throw new PaymentError(503,'Scanning is unavailable. Enter the reference manually.');
 if(active)throw new PaymentError(429,'Scanner is busy. Try again shortly.');active=true;let clean:Buffer|undefined;
 try{clean=await cleanReceipt(bytes,mime);
  const result=await new Promise<OcrResult>((resolve,reject)=>{
   // A separate bounded process avoids bundler path rewriting, and can be killed
   // during initialization too. It receives no database/provider/auth secrets.
   const child=spawn(process.execPath,[join(process.cwd(),'scripts/receipt-ocr.cjs')],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{NODE_ENV:'production',SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});let output='',timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;child.kill();},20000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.length>12000)child.kill()});child.stdin.on('error',()=>{});
   child.on('error',()=>{clearTimeout(timer);reject(new PaymentError(503,'Scanning is unavailable. Enter the reference manually.'))});
   child.on('close',code=>{clearTimeout(timer);if(code!==0||timedOut){reject(new PaymentError(503,'Scan failed or timed out. Enter the reference manually.'));return}try{resolve(JSON.parse(output))}catch{reject(new PaymentError(422,'Scan was unclear. Enter the reference manually.'))}});child.stdin.end(clean);
  });
  return extractedReference(result,bank);
 }finally{clean?.fill(0);bytes.fill(0);active=false}
}
// Images are memory-only, metadata stripped, never written or returned. The worker
// is destroyed after every job, including failed scans; no receipt retention store.
