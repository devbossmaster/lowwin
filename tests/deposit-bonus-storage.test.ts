import {afterEach,describe,expect,it,vi} from 'vitest';
import {depositBonusStorageReady} from '../src/modules/wallet/deposit-bonus';

afterEach(()=>vi.restoreAllMocks());

describe('deposit bonus schema readiness',()=>{
 it('shares a pending probe and caches positive schema existence for five minutes from completion',async()=>{
  let finish!:(rows:Array<{ready:boolean}>)=>void;
  const query=vi.fn().mockImplementationOnce(()=>new Promise<Array<{ready:boolean}>>(resolve=>{finish=resolve})).mockResolvedValue([{ready:false}]);
  const client={$queryRaw:query},now=vi.spyOn(Date,'now').mockReturnValue(1000);
  const first=depositBonusStorageReady(client as never),second=depositBonusStorageReady(client as never);
  expect(query).toHaveBeenCalledOnce();now.mockReturnValue(5000);finish([{ready:true}]);
  expect(await Promise.all([first,second])).toEqual([true,true]);
  now.mockReturnValue(304999);expect(await depositBonusStorageReady(client as never)).toBe(true);expect(query).toHaveBeenCalledOnce();
  now.mockReturnValue(305000);expect(await depositBonusStorageReady(client as never)).toBe(false);expect(query).toHaveBeenCalledTimes(2);
 });
 it('rechecks a missing schema after thirty seconds so an additive rollout becomes visible',async()=>{
  const query=vi.fn().mockResolvedValueOnce([{ready:false}]).mockResolvedValueOnce([{ready:true}]);
  const client={$queryRaw:query},now=vi.spyOn(Date,'now').mockReturnValue(1000);
  expect(await depositBonusStorageReady(client as never)).toBe(false);now.mockReturnValue(30999);
  expect(await depositBonusStorageReady(client as never)).toBe(false);expect(query).toHaveBeenCalledOnce();
  now.mockReturnValue(31000);expect(await depositBonusStorageReady(client as never)).toBe(true);expect(query).toHaveBeenCalledTimes(2);
 });
 it('does not cache failed probes and keeps explicit fresh checks independent',async()=>{
  const query=vi.fn().mockRejectedValueOnce(Error('Unavailable')).mockImplementationOnce(()=>{throw Error('Synchronous failure')}).mockResolvedValueOnce([{ready:false}]).mockResolvedValueOnce([{ready:true}]);
  const client={$queryRaw:query};
  await expect(depositBonusStorageReady(client as never)).rejects.toThrow('Unavailable');
  await expect(depositBonusStorageReady(client as never)).rejects.toThrow('Synchronous failure');
  expect(await depositBonusStorageReady(client as never)).toBe(false);
  expect(await depositBonusStorageReady(client as never,true)).toBe(true);expect(query).toHaveBeenCalledTimes(4);
 });
 it('keeps a fresh probe authoritative when an older pending probe finishes later',async()=>{
  let finish!:(rows:Array<{ready:boolean}>)=>void;
  const query=vi.fn().mockImplementationOnce(()=>new Promise<Array<{ready:boolean}>>(resolve=>{finish=resolve})).mockResolvedValueOnce([{ready:true}]);
  const client={$queryRaw:query},older=depositBonusStorageReady(client as never);
  expect(await depositBonusStorageReady(client as never,true)).toBe(true);finish([{ready:false}]);expect(await older).toBe(false);
  expect(await depositBonusStorageReady(client as never)).toBe(true);expect(query).toHaveBeenCalledTimes(2);
 });
 it('keeps readiness scoped to its database client',async()=>{
  const first={$queryRaw:vi.fn().mockResolvedValue([{ready:true}])},second={$queryRaw:vi.fn().mockResolvedValue([{ready:false}])};
  expect(await depositBonusStorageReady(first as never)).toBe(true);expect(await depositBonusStorageReady(second as never)).toBe(false);
  expect(first.$queryRaw).toHaveBeenCalledOnce();expect(second.$queryRaw).toHaveBeenCalledOnce();
 });
});
