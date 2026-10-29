import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {diagnoseChapaWebhookAuthorization} from '../src/modules/payments/chapa-webhook-diagnostic';

async function readHeader(){
 if(process.stdin.isTTY){
  // Readline owns raw TTY input; discarding its output hides typed/pasted data.
  const hidden=new Writable({write(_chunk,_encoding,callback){callback()}});
  const reader=createInterface({input:process.stdin,output:hidden,terminal:true});
  process.stdout.write('Paste the Chapa Authorization value or Headers JSON (hidden), then Enter: ');
  try{return await reader.question('')}finally{reader.close();process.stdout.write('\n')}
 }
 let input='';for await(const chunk of process.stdin){input+=chunk.toString();if(input.length>8192)throw Error('INPUT_TOO_LARGE')}
 return input;
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help'){
  console.log('Run in the deployed Lowwin WEB container: npx --no-install tsx scripts/check-chapa-webhook-auth.ts\nPaste Authorization or the one-line Headers JSON at the hidden prompt. Do not pass credentials as arguments or post them in chat. Uses runtime environment only; no .env files, HTTP, database or bot calls. Output contains only booleans and diagnosis codes. Signature mode requires the exact raw body and signature and is not tested by this command.');return;
 }
 if(args.length){console.error(JSON.stringify({error:'UNKNOWN_OPTION',usage:'npx --no-install tsx scripts/check-chapa-webhook-auth.ts [--help]'}));process.exitCode=1;return}
 console.log(JSON.stringify(diagnoseChapaWebhookAuthorization(await readHeader()),null,2));
}
void main().catch(()=>{console.error(JSON.stringify({error:'DIAGNOSTIC_INPUT_UNAVAILABLE'}));process.exitCode=1});
