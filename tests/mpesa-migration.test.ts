import {describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';

const base=process.env.TEST_DATABASE_URL;
const migration='202610050001_mpesa_receiving_accounts';
describe.skipIf(!base)('M-Pesa receiving-account migration',()=>{
 it('allows M-Pesa, preserves existing account versions, and retains channel and immutability guards',async()=>{
  const url=new URL(base!);
  if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback only');
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';
  const admin=new Client({connectionString:adminUrl.href});await admin.connect();
  const name=`lowwin_mpesa_upgrade_${randomBytes(5).toString('hex')}_test`;
  try{await admin.query(`CREATE DATABASE "${name}"`)}finally{await admin.end()}
  url.pathname=`/${name}`;
  const pg=new Client({connectionString:url.href});await pg.connect();
  try{
   const dirs=readdirSync('prisma/migrations').filter(x=>/^\d/.test(x)).sort();
   for(const dir of dirs.filter(d=>d<migration))await pg.query(readFileSync(`prisma/migrations/${dir}/migration.sql`,'utf8'));
   const insert=(channel:string,id=channel)=>pg.query(`INSERT INTO "PaymentPolicy"
    (id,channel,version,enabled,account,"accountName","pointsNumerator","centsDenominator","minCents","maxCents",terms,"reviewReference","actorId")
    VALUES ($1,$2,1,true,$3,'Fixture receiver',1,100,100,100000,'Fixture terms','Fixture review','fixture-owner')`,[id,channel,channel==='cbe'?'1000303997441':'0711111111']);
   await insert('telebirr');await insert('cbe');
   await expect(insert('mpesa','before-upgrade')).rejects.toMatchObject({code:'23514',constraint:'PaymentPolicy_channel_check'});
   const before=(await pg.query('SELECT to_jsonb(p) AS value FROM "PaymentPolicy" p ORDER BY id')).rows;
   await pg.query(readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8'));
   expect((await pg.query('SELECT to_jsonb(p) AS value FROM "PaymentPolicy" p ORDER BY id')).rows).toEqual(before);
   await insert('mpesa');
   expect((await pg.query('SELECT channel FROM "PaymentPolicy" ORDER BY channel')).rows.map(r=>r.channel)).toEqual(['cbe','mpesa','telebirr']);
   await expect(insert('unsupported')).rejects.toMatchObject({code:'23514',constraint:'PaymentPolicy_channel_check'});
   await expect(pg.query('UPDATE "PaymentPolicy" SET account=$1 WHERE id=$2',['0722222222','mpesa'])).rejects.toThrow('Immutable');
  }finally{await pg.query('ROLLBACK').catch(()=>{});await pg.end()}
 },60000);
});
