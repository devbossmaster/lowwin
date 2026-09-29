import {describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';

const base=process.env.TEST_DATABASE_URL;
describe.skipIf(!base)('cent migration over populated legacy money',()=>{
 it('preserves existing values and immutable records, then handles a cent beyond Number precision',async()=>{
  const url=new URL(base!);if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback only');
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';
  const admin=new Client({connectionString:adminUrl.href});await admin.connect();
  const name=`lowwin_cent_upgrade_${randomBytes(5).toString('hex')}_test`;
  try{await admin.query(`CREATE DATABASE "${name}"`)}finally{await admin.end()}
  url.pathname=`/${name}`;const pg=new Client({connectionString:url.href});await pg.connect();
  let prisma:PrismaClient|undefined;
  try{
   const dirs=readdirSync('prisma/migrations').filter(x=>/^\d/.test(x)).sort();
   for(const dir of dirs.filter(d=>d<'202609300001_cent_money_v3'))await pg.query(readFileSync(`prisma/migrations/${dir}/migration.sql`,'utf8'));
   await pg.query(`BEGIN;
    INSERT INTO "user" (id,name,"updatedAt") VALUES ('legacy-cent-user','DEMO upgrade fixture',now());
    INSERT INTO "Wallet" (id,"userId") VALUES ('legacy-wallet','legacy-cent-user');
    INSERT INTO "LedgerAccount" (id,name,kind,"walletId") VALUES
     ('legacy-available','user:legacy-cent-user:available','AVAILABLE','legacy-wallet'),
     ('legacy-held','user:legacy-cent-user:held','HELD','legacy-wallet'),
     ('legacy-issuance','platform:issuance','ISSUANCE',NULL);
    INSERT INTO "Operation" (id,"userId",scope,key,"requestHash",result) VALUES
     ('legacy-credit','legacy-cent-user','DEV_CREDIT','legacy-credit-key','legacy-hash','{"available":"9007199254740993","credited":"9007199254740993"}');
    INSERT INTO "Journal" (id,"operationId",kind,reference) VALUES ('legacy-journal','legacy-credit','DEV_CREDIT','DEMO upgrade');
    INSERT INTO "Posting" (id,"journalId","accountId",delta) VALUES
     ('legacy-in','legacy-journal','legacy-available',9007199254740993),
     ('legacy-out','legacy-journal','legacy-issuance',-9007199254740993);
    COMMIT;`);
   const snapshot=async()=>Promise.all(['LedgerAccount','Posting','Journal','Operation','CurrencyConversion'].map(async table=>(await pg.query(`SELECT row_to_json(t)::text AS value FROM "${table}" t ORDER BY id`)).rows));
   const before=await snapshot();
   await pg.query(readFileSync('prisma/migrations/202609300001_cent_money_v3/migration.sql','utf8'));
   expect(await snapshot()).toEqual(before);
   prisma=new PrismaClient({datasourceUrl:url.href});
   Object.assign(process.env,{NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true'});
   await creditDevelopmentPoints(prisma,'legacy-cent-user','0.01','cent-upgrade-credit');
   expect((await prisma.ledgerAccount.findUniqueOrThrow({where:{id:'legacy-available'}})).balance.toString()).toBe('9007199254740993.01');
   expect(await reconcile(prisma)).toEqual([]);
   await expect(pg.query(`UPDATE "Posting" SET delta=1 WHERE id='legacy-in'`)).rejects.toThrow('Immutable');
  }finally{await prisma?.$disconnect();await pg.end()}
 },60000);
});
