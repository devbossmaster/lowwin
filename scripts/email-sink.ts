import { createServer } from 'node:http';
import { mkdir,appendFile } from 'node:fs/promises';
import path from 'node:path';
// Loopback-only development sink. The file contains credential links: never serve,
// commit or share it. Production transport explicitly refuses this adapter.
const port=Number(process.env.EMAIL_SINK_PORT??8027),directory=path.resolve('.local/email-sink');
await mkdir(directory,{recursive:true});
createServer(async(req,res)=>{if(req.method==='GET'&&req.url==='/health'){res.writeHead(200).end('local email sink');return}if(req.method!=='POST'||req.url!=='/mail'){res.writeHead(404).end();return}let body='';for await(const chunk of req){body+=chunk;if(body.length>16384){res.writeHead(413).end();return}}try{const mail=JSON.parse(body);if(typeof mail.to!=='string'||typeof mail.text!=='string')throw Error();await appendFile(path.join(directory,'messages.jsonl'),JSON.stringify({...mail,receivedAt:new Date().toISOString()})+'\n',{mode:0o600});res.writeHead(202).end()}catch{res.writeHead(400).end()}}).listen(port,'127.0.0.1',()=>console.log(`Local email sink listening on 127.0.0.1:${port}; messages stored in .local/email-sink/messages.jsonl`));
