import {open} from 'node:fs/promises';
import {CHAPA_WEBHOOK_MAX_BYTES,chapaWebhookSignatureConfiguration,diagnoseChapaWebhookSignature} from '../src/modules/payments/chapa-webhook-diagnostic';

const usage='npx --no-install tsx scripts/check-chapa-webhook-signature.ts [--body-file <path> --signature-file <path>]';
class DiagnosticInputError extends Error{}

async function readBoundedFile(path:string,maximum:number){
 const file=await open(path,'r');
 try{
  const metadata=await file.stat();
  if(!metadata.isFile())throw new DiagnosticInputError('DIAGNOSTIC_FILE_REQUIRED');
  if(metadata.size>maximum)throw new DiagnosticInputError('DIAGNOSTIC_FILE_TOO_LARGE');
  // A fixed-size buffer also bounds memory if a file grows after stat().
  const bytes=Buffer.alloc(maximum+1);let size=0;
  while(size<bytes.length){const result=await file.read(bytes,size,bytes.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead}
  if(size>maximum)throw new DiagnosticInputError('DIAGNOSTIC_FILE_TOO_LARGE');
  return bytes.subarray(0,size);
 }finally{await file.close()}
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help'){
  console.log(`${usage}\nDefault: offline runtime configuration report. To compare a real delivery, export its exact raw HTTP body and x-chapa-signature value into separate private files. A signature file may end in a newline. Pretty-printed dashboard JSON is not the original raw body. No .env files are loaded; no HTTP, database, payment or bot calls are made. Output contains only booleans and diagnosis codes. Never put secrets or signature values in command arguments or chat.`);return;
 }
 if(!args.length){const result=chapaWebhookSignatureConfiguration();console.log(JSON.stringify(result,null,2));if(!result.configurationValid)process.exitCode=1;return}
 if(args.length!==4||args[0]!=='--body-file'||args[2]!=='--signature-file'||!args[1]||!args[3]||args[1].startsWith('--')||args[3].startsWith('--')){
  console.error(JSON.stringify({error:'INVALID_OPTIONS',usage}));process.exitCode=1;return;
 }
 const [body,signatureBytes]=await Promise.all([readBoundedFile(args[1],CHAPA_WEBHOOK_MAX_BYTES),readBoundedFile(args[3],512)]);
 const signature=signatureBytes.toString('utf8').trim();
 const result=diagnoseChapaWebhookSignature(body,signature);
 console.log(JSON.stringify(result,null,2));if(!result.authenticationAccepted)process.exitCode=1;
}
void main().catch(error=>{console.error(JSON.stringify({error:error instanceof DiagnosticInputError?error.message:'DIAGNOSTIC_FILE_UNAVAILABLE'}));process.exitCode=1});
