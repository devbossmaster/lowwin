import { PrismaClient } from '@prisma/client';
import {createHash} from 'node:crypto';
import {runtimeDatabaseUrl} from './database-config';

const datasourceUrl=runtimeDatabaseUrl(process.env.DATABASE_URL);
const configKey=createHash('sha256').update(datasourceUrl??'schema-default').digest('hex');
const globalDb = globalThis as unknown as { lowinDb?: PrismaClient; lowinDbConfigKey?:string };
const reusable=process.env.NODE_ENV!=='production'&&globalDb.lowinDbConfigKey===configKey;

// Next dev preserves globals across env/module reloads. Never reuse a pool
// created with a previous URL, password, port or timeout configuration.
if(process.env.NODE_ENV!=='production'&&globalDb.lowinDb&&!reusable) {
  void globalDb.lowinDb.$disconnect().catch(()=>{
    console.warn('Previous development database pool could not close.');
  });
}
export const db = reusable&&globalDb.lowinDb
  ? globalDb.lowinDb
  : new PrismaClient(datasourceUrl?{datasourceUrl}:undefined);
if (process.env.NODE_ENV !== 'production') {
  globalDb.lowinDb = db;
  globalDb.lowinDbConfigKey = configKey;
}
