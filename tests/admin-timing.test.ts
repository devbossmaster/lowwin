import {expect,it} from 'vitest';
import {adminRequestTimings,measureAdmin,timedAdminResponse} from '../src/modules/admin/timing';

it('keeps admin request timings separate and records failing phases',async()=>{
 let release!:()=>void;
 let transactionStarted!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve});
 const started=new Promise<void>(resolve=>{transactionStarted=resolve});
 const write=timedAdminResponse(async()=>{
  try{
   await measureAdmin('transaction',async()=>{
    transactionStarted();
    await blocked;
    throw new Error('fixture');
   });
  }catch{
   return Response.json(adminRequestTimings(),{status:503});
  }
  throw Error('Expected failing fixture');
 });
 await started;
 const read=await timedAdminResponse(async()=>{
  await measureAdmin('read',async()=>{});
  return Response.json(adminRequestTimings());
 });
 release();
 const failed=await write;
 expect(failed.headers.get('server-timing')).toMatch(/admin_transaction;dur=[\d.]+, admin_total;dur=[\d.]+/);
 expect((await failed.json()).phasesMs).toEqual({transaction:expect.any(Number)});
 expect(read.headers.get('server-timing')).toMatch(/admin_read;dur=[\d.]+, admin_total;dur=[\d.]+/);
 expect((await read.json()).phasesMs).toEqual({read:expect.any(Number)});
 expect(adminRequestTimings()).toEqual({});
});
