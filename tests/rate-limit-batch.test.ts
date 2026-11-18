import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {allowIdentityRequest,allowIdentityRequests,type IdentityRequestLimit} from '../src/lib/rate-limit';

const database=process.env.RATE_LIMIT_BATCH_TEST_DATABASE_URL;
const key=(scope:string,identity:string)=>`app:${scope}:${createHash('sha256').update(identity).digest('hex')}`;
describe.skipIf(!database)('atomic batched identity limits on isolated PostgreSQL',()=>{
 let db:PrismaClient,capture:string[]|null=null;
 beforeAll(async()=>{
  const target=new URL(database!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:database!,DIRECT_URL:database!},stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database!,log:[{level:'query',emit:'event'}]});(db as PrismaClient<Prisma.PrismaClientOptions,'query'>).$on('query',event=>capture?.push(event.query));await db.$connect();
 },60000);
 afterAll(async()=>{vi.restoreAllMocks();await db?.$disconnect()});
 const read=(limit:IdentityRequestLimit)=>db.rateLimit.findUnique({where:{key:key(limit.scope,limit.identity)}});
 const limits=()=>{const id=randomUUID();return [{scope:'batch-create-'+id,identity:'member-'+id,maximum:24,windowMs:3600000},{scope:'batch-initialize-'+id,identity:'checkout-'+id,maximum:5,windowMs:86400000}] satisfies IdentityRequestLimit[]};
 const commit=async(rows:IdentityRequestLimit[])=>db.$transaction(async tx=>{if(!await allowIdentityRequests(tx,rows))throw Error('RATE_LIMITED')});

 it('uses one statement, keeps the existing hashed key namespace and charges both first-dispatch budgets',async()=>{
  const rows=limits(),queries:string[]=[];capture=queries;try{expect(await allowIdentityRequests(db,rows)).toBe(true)}finally{capture=null}
  expect(queries).toHaveLength(1);expect(queries[0]).toContain('INSERT INTO "rateLimit"');
  for(const row of rows)expect(await read(row)).toMatchObject({key:key(row.scope,row.identity),count:1});
  // The original single-limit function and new batch share the same counters.
  expect(await allowIdentityRequest(db,rows[1].scope,rows[1].identity,5,86400000)).toBe(true);expect((await read(rows[1]))!.count).toBe(2);
 });
 it('preserves the daily five-initialization budget including its first dispatch',async()=>{
  const rows=limits();await commit(rows);
  for(let i=0;i<4;i++)expect(await allowIdentityRequest(db,rows[1].scope,rows[1].identity,5,86400000)).toBe(true);
  expect((await read(rows[1]))!.count).toBe(5);
  await expect(db.$transaction(async tx=>{if(!await allowIdentityRequest(tx,rows[1].scope,rows[1].identity,5,86400000))throw Error('RATE_LIMITED')})).rejects.toThrow('RATE_LIMITED');
  expect((await read(rows[1]))!.count).toBe(5);expect((await read(rows[0]))!.count).toBe(1);
 });
 it('admits exactly24 new hourly checkouts and rolls back both budgets for the25th',async()=>{
  const [create,initialize]=limits();
  for(let i=0;i<24;i++)await commit([create,{...initialize,identity:initialize.identity+'-'+i}]);
  expect((await read(create))!.count).toBe(24);
  for(let i=0;i<24;i++)expect((await read({...initialize,identity:initialize.identity+'-'+i}))!.count).toBe(1);
  const denied={...initialize,identity:initialize.identity+'-denied'};await expect(commit([create,denied])).rejects.toThrow('RATE_LIMITED');
  expect((await read(create))!.count).toBe(24);expect(await read(denied)).toBeNull();
 });
 it('rolls back an accepted increment and a newly inserted companion when later intent work fails',async()=>{
  const rows=limits();expect(await allowIdentityRequest(db,rows[0].scope,rows[0].identity,24,3600000)).toBe(true);const original=await read(rows[0]);
  await expect(db.$transaction(async tx=>{expect(await allowIdentityRequests(tx,rows)).toBe(true);throw Error('SYNTHETIC_INTENT_REJECTED')})).rejects.toThrow('SYNTHETIC_INTENT_REJECTED');
  expect(await read(rows[0])).toEqual(original);expect(await read(rows[1])).toBeNull();
 });
 it('increments every counter and returns false if either budget is exhausted outside a caller transaction',async()=>{
  const rows=limits();await commit(rows);const original=await read(rows[0]);await db.rateLimit.update({where:{key:original!.key},data:{count:24}});
  expect(await allowIdentityRequests(db,rows)).toBe(false);expect(await read(rows[0])).toMatchObject({count:25,lastRequest:original!.lastRequest});expect((await read(rows[1]))!.count).toBe(2);
  expect(await allowIdentityRequests(db,rows)).toBe(false);expect((await read(rows[0]))!.count).toBe(25);expect((await read(rows[1]))!.count).toBe(3);
 });
 it('enforces the exact concurrent maximum with reversed input order and no lost increments or crossed row locks',async()=>{
  const rows=limits().map((row,index)=>({...row,maximum:index===0?7:31}));
  const responses=await Promise.all(Array.from({length:40},(_,index)=>allowIdentityRequests(db,index%2?[...rows].reverse():rows)));
  expect(responses.filter(Boolean)).toHaveLength(7);expect((await read(rows[0]))!.count).toBe(8);expect((await read(rows[1]))!.count).toBe(32);
 });
 it('retains fixed windows on denial and renews only expired counters using the PostgreSQL clock',async()=>{
  const rows=limits();await commit(rows);const original=await read(rows[0]);await db.rateLimit.update({where:{key:original!.key},data:{count:24}});
  expect(await allowIdentityRequests(db,rows)).toBe(false);expect(await read(rows[0])).toMatchObject({count:25,lastRequest:original!.lastRequest});
  await db.rateLimit.update({where:{key:original!.key},data:{lastRequest:original!.lastRequest-BigInt(rows[0].windowMs!)-1000n}});
  vi.spyOn(Date,'now').mockReturnValue(0);
  try{expect(await db.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`;return allowIdentityRequests(tx,rows)})).toBe(true)}finally{vi.restoreAllMocks()}
  const renewed=await read(rows[0]),companion=await read(rows[1]),[{now}]=await db.$queryRaw<{now:bigint}[]>`SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint AS now`;
  expect(renewed!.count).toBe(1);expect(now-renewed!.lastRequest).toBeGreaterThanOrEqual(0n);expect(now-renewed!.lastRequest).toBeLessThan(5000n);expect(companion!.count).toBe(3);
 });
 it('keeps identities and scopes separate and rejects duplicate hashed keys before any SQL',async()=>{
  const id=randomUUID(),rows=[{scope:'one-'+id,identity:id,maximum:3},{scope:'two-'+id,identity:id,maximum:3}];expect(await allowIdentityRequests(db,rows)).toBe(true);
  expect(await read(rows[0])).not.toBeNull();expect(await read(rows[1])).not.toBeNull();
  const queries:string[]=[];capture=queries;try{await expect(allowIdentityRequests(db,[rows[0],{...rows[0],maximum:9}])).rejects.toThrow('Duplicate identity limit')}finally{capture=null}expect(queries).toEqual([]);
 });
 it('accepts an empty batch without SQL and rejects more than eight limits before any write',async()=>{
  const queries:string[]=[];capture=queries;try{expect(await allowIdentityRequests(db,[])).toBe(true);await expect(allowIdentityRequests(db,Array.from({length:9},(_,index)=>({scope:'too-many',identity:String(index),maximum:1})))).rejects.toThrow('Too many identity limits')}finally{capture=null}expect(queries).toEqual([]);
 });
 it.each([{maximum:0},{maximum:1.5},{maximum:1000001},{windowMs:0},{windowMs:1.5},{windowMs:Number.MAX_SAFE_INTEGER+1}])('rejects invalid limit %j before any SQL',async invalid=>{
  const queries:string[]=[];capture=queries;try{await expect(allowIdentityRequests(db,[{scope:'invalid',identity:randomUUID(),maximum:1,...invalid}])).rejects.toThrow('Invalid identity limit')}finally{capture=null}expect(queries).toEqual([]);
 });
});
