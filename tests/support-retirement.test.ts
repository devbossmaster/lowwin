import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {opsMutation,opsRead,type OpsAction,sectionPermission} from '../src/modules/admin/ops';
import {adminRead} from '../src/modules/admin/operations';
import {GET,POST} from '../src/app/api/support/route';
import {TELEGRAM_SUPPORT_URL} from '../src/lib/telegram-community';

vi.mock('../src/modules/admin/boundary',()=>({requireAdmin:vi.fn(async()=>({id:'fixture-staff',role:'SUPPORT',now:new Date()}))}));
describe('built-in support retirement',()=>{
 it.each(['support','supportWithdraw'])('rejects the retired %s command before touching data',async action=>{
  const $transaction=vi.fn(),client={$transaction} as unknown as PrismaClient;
  await expect(opsMutation(client,new Headers(),action as OpsAction,{})).rejects.toMatchObject({status:404});
  expect($transaction).not.toHaveBeenCalled();
 });
 it('removes inbox reads and keeps messages authorized as a separate task',async()=>{
  const client={} as PrismaClient;
  expect(sectionPermission.support).toBeUndefined();expect(sectionPermission.notifications).toBe('jobs');
  await expect(opsRead(client,new Headers(),['support'],new URLSearchParams())).rejects.toMatchObject({status:404});
  await expect(adminRead(client,new Headers(),['support'],new URLSearchParams())).rejects.toMatchObject({status:404});
 });
 it('prevents staff proposals from silently creating cases in the retired inbox',async()=>{
  const $transaction=vi.fn(),client={$transaction} as unknown as PrismaClient;
  await expect(opsMutation(client,new Headers(),'suspend',{key:randomUUID(),userId:'fixture-player',suspended:true,reason:'Fixture review reason'})).rejects.toMatchObject({status:403});
  expect($transaction).not.toHaveBeenCalled();
 });
 it('directs old customer API requests to Telegram without creating a case',async()=>{
  for(const handler of [GET,POST]){
   const response=handler(new Request('https://lowwin.example/api/support'));
   expect(response.status).toBe(410);expect(await response.json()).toMatchObject({supportUrl:TELEGRAM_SUPPORT_URL});
  }
 });
});
