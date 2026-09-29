import 'dotenv/config';
import {createClient} from 'redis';
const url=process.env.REDIS_URL;
if(!url){console.error('REDIS_URL is missing.');process.exit(1)}
const client=createClient({url,disableOfflineQueue:true,socket:{connectTimeout:3000,reconnectStrategy:false}});
client.on('error',()=>{});
try{await client.connect();if(await client.withCommandOptions({timeout:3000}).ping()!=='PONG')throw Error();console.log('Redis reachable. No credentials logged.')}catch{console.error('Redis unavailable. Check the private service and configuration.');process.exitCode=1}finally{if(client.isOpen)client.destroy()}
