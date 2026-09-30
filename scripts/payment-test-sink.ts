import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
const url=new URL(process.env.DATABASE_URL??'');if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback fixtures only');
const checks=new Map<string,number>();
export const server=createServer(async(req,res)=>{
 if(req.url==='/health'){res.end('ok');return}
 if(new URL(req.url??'/', 'http://127.0.0.1:8030').pathname!=='/api/verify'||req.method!=='POST'){res.writeHead(404).end();return}
 let text='';for await(const chunk of req){text+=chunk;if(text.length>4096){res.writeHead(413).end();return}}
 try{
  const body=JSON.parse(text) as {bank:string;transactionNumber?:string;reference?:string;settlementAccount:string};
  const reference=body.transactionNumber??body.reference??'',count=(checks.get(reference)??0)+1;checks.set(reference,count);
  const review=reference.startsWith('REVIEW')&&count===1;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,requestId:randomUUID(),verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:body.bank,status:'success',verified:true,amount:'100.00',currency:'ETB',receiverAccount:review?undefined:body.settlementAccount,referenceNumber:reference,timestamp:new Date().toISOString()}]}));
 }catch{res.writeHead(422).end('{}')}
}).listen(8030,'127.0.0.1');
