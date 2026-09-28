import nextEnv from '@next/env';
import {PrismaClient} from '@prisma/client';
import {runtimeDatabaseUrl} from '../src/lib/database-config';

const loaded=nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production');
for(const file of loaded.loadedEnvFiles) {
  if((file.contents.match(/^\s*(?:export\s+)?DATABASE_URL\s*=/gm)??[]).length>1) {
    throw new Error(`Duplicate DATABASE_URL entries in ${file.path}. Keep one authoritative value.`);
  }
}
const datasourceUrl=runtimeDatabaseUrl(process.env.DATABASE_URL);
if(!datasourceUrl)throw new Error('DATABASE_URL is required');
const url=new URL(datasourceUrl);
const db=new PrismaClient({datasourceUrl});
const started=performance.now();
const deadline=setTimeout(()=>{console.error('Database check timed out after 25 seconds.');process.exit(1)},25000);
try {
  // Read-only: no user/session creation, migrations, seeds or credential output.
  await db.$queryRaw`SELECT 1`;
  console.log(JSON.stringify({database:'reachable',host:url.hostname,port:url.port||'5432',elapsedMs:Math.round(performance.now()-started)}));
}catch(error) {
  const failure=error as {code?:string;errorCode?:string};
  console.error(JSON.stringify({database:'unavailable',host:url.hostname,port:url.port||'5432',code:failure.code??failure.errorCode??'CONNECTION_FAILED'}));
  process.exitCode=1;
}finally {await db.$disconnect();clearTimeout(deadline)}
