import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import type {Bank} from './provider';
import {candidate,canonical,PaymentError} from './reference';
export const RECEIPT_LIMIT=5*1024*1024;
export async function cleanReceipt(bytes:Buffer,mime:string){
 await validateReceiptImage(bytes,mime);
 try{return await sharp(bytes,{limitInputPixels:12000000,failOn:'warning',animated:true}).rotate().png().toBuffer()}
 catch{throw new PaymentError(422,'Image cannot be safely decoded. Use a smaller static receipt or enter the reference.')}
}
export async function validateReceiptImage(bytes:Buffer,mime:string){
 if(!bytes.length||bytes.length>RECEIPT_LIMIT)throw new PaymentError(413,'Use a receipt image smaller than 5 MB.');
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!({ 'image/png':png,'image/jpeg':jpeg,'image/webp':webp} as Record<string,boolean>)[mime])throw new PaymentError(422,'Use a static PNG, JPEG or WebP receipt.');
 try{
  const meta=await sharp(bytes,{limitInputPixels:12000000,failOn:'warning',animated:true}).metadata();
  if((meta.pages??1)!==1||!meta.width||!meta.height||meta.width>6000||meta.height>6000||png&&bytes.includes(Buffer.from('acTL')))throw Error();
 }catch{throw new PaymentError(422,'Image cannot be safely decoded. Use a smaller static receipt or enter the reference.')}
}
let active=false;
type OcrResult={text:string;confidence:number;words?:{text:string;confidence:number}[]};
function literalReferences(text:string,bank:Bank){return [...new Set((text.match(/[A-Za-z0-9_-]+/g)??[]).filter(token=>/\d/.test(token)&&/[A-Za-z]/.test(token)).flatMap(token=>{try{return [canonical(bank,token)]}catch{return []}}))]}
export class ReceiptScanError extends PaymentError{
 constructor(error:PaymentError,public diagnostics:{pass:number;characters:number;candidateCount:number;confidence:number|null}[],public referencesAgree:boolean){super(error.status,error.message)}
}
export function extractedReference(result:OcrResult,bank:Bank){
 if(typeof result.text!=='string'||typeof result.confidence!=='number'||!Number.isFinite(result.confidence))throw new PaymentError(422,'Scan is uncertain. Enter the reference manually.');
 if(!result.text.trim())throw new PaymentError(422,'Could not read the screenshot. Paste the payment SMS or transaction reference.');
 let reference:string;
 try{reference=candidate(bank,result.text)}catch(error){
  if(!(error instanceof PaymentError)||error.message!=='A single clear reference could not be found. Enter it manually.')throw error;
  // OCR may lose an Amharic or stylized label while reading its code clearly.
  // Extract only one literal mixed letter/number candidate; never guess replacement characters.
  const tokens=literalReferences(result.text,bank);
  if(tokens.length!==1)throw error;
  reference=tokens[0];
 }
 const literalCodes=literalReferences(result.text,bank);
 if(literalCodes.length>1)throw new PaymentError(422,'A single clear reference could not be found. Enter it manually.');
 // Unrelated artwork and Amharic text must not outweigh a clearly read reference.
 const words=Array.isArray(result.words)?result.words.filter(w=>typeof w.text==='string'&&(w.text.match(/[A-Za-z0-9_-]+/g)??[]).some(token=>token===reference||bank!=='cbe'&&token.toUpperCase()===reference)):[];
 const confidence=words.length?Math.max(...words.map(w=>Number.isFinite(w.confidence)?w.confidence:0)):result.confidence;
 if(confidence<35)throw new PaymentError(422,'Scan is uncertain. Enter the reference manually.');
 // This is an editable extraction, never payment evidence or an automatic credit.
 return {reference,reviewRequired:true,uncertain:confidence<75};
}
export function combineExtractions(passes:OcrResult[],bank:Bank){
 if(passes.length!==2)throw new PaymentError(422,'Scan is uncertain. Enter the reference manually.');
 let referencesAgree=false;
 try{
 const results=passes.map(pass=>{try{return extractedReference(pass,bank)}catch(error){
  // Multiple plausible references remain ambiguous even if the other pass reads one.
  const codes=literalReferences(pass.text??'',bank);
  if(codes.length>1||error instanceof PaymentError&&error.message==='Receipt bank does not match the selected account.')throw error;
  return null;
 }}).filter((value):value is ReturnType<typeof extractedReference>=>!!value);
 if(!results.length)throw new PaymentError(422,'Could not read the screenshot. Paste the payment SMS or transaction reference.');
 referencesAgree=results.length===2&&results[0].reference===results[1].reference;
 if(new Set(results.map(r=>r.reference)).size!==1)throw new PaymentError(422,'Scan is uncertain. Enter the reference manually.');
 return {...results[0],referencesAgree,uncertain:!referencesAgree||results.some(r=>r.uncertain)};
 }catch(error){
  if(!(error instanceof PaymentError))throw error;
  throw new ReceiptScanError(error,passes.map((pass,index)=>({pass:index+1,characters:typeof pass.text==='string'?pass.text.length:0,candidateCount:typeof pass.text==='string'?literalReferences(pass.text,bank).length:0,confidence:Number.isFinite(pass.confidence)?Math.round(Math.max(0,Math.min(100,pass.confidence))):null})),referencesAgree);
 }
}
export async function scanReceipt(bytes:Buffer,mime:string,bank:Bank){
 if(process.env.RECEIPT_OCR!=='tesseract')throw new PaymentError(503,'Scanning is unavailable. Enter the reference manually.');
 if(active)throw new PaymentError(429,'Scanner is busy. Try again shortly.');active=true;let clean:Buffer|undefined;
 try{clean=await cleanReceipt(bytes,mime);
  const result=await new Promise<{passes:OcrResult[]}>((resolve,reject)=>{
   // A separate bounded process avoids bundler path rewriting, and can be killed
   // during initialization too. It receives no database/provider/auth secrets.
   const child=spawn(process.execPath,['--max-old-space-size=256',join(process.cwd(),'scripts/receipt-ocr.cjs')],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{NODE_ENV:'production',OMP_THREAD_LIMIT:'1',SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});let output='',timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;child.kill();},20000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.length>24000)child.kill()});child.stdin.on('error',()=>{});
   child.on('error',()=>{clearTimeout(timer);reject(new PaymentError(503,'Scanning is unavailable. Enter the reference manually.'))});
   child.on('close',code=>{clearTimeout(timer);if(code!==0||timedOut){reject(new PaymentError(503,'Scan failed or timed out. Enter the reference manually.'));return}try{resolve(JSON.parse(output))}catch{reject(new PaymentError(422,'Scan was unclear. Enter the reference manually.'))}});child.stdin.end(clean);
  });
  return combineExtractions(result.passes,bank);
 }finally{clean?.fill(0);bytes.fill(0);active=false}
}
// Images are memory-only, metadata stripped, never written or returned. The worker
// is destroyed after every job, including failed scans; no receipt retention store.
