import {describe,expect,it} from 'vitest';
import {serviceCommand} from '../deploy/service.mjs';

describe('managed Lowwin service dispatch',()=>{
 it('selects the dedicated Chapa recovery worker without launching an unrelated worker',()=>{
  expect(serviceCommand('chapa')).toEqual(['--import','tsx','scripts/chapa-worker.ts']);
  expect(serviceCommand('notifications')).toEqual(['--import','tsx','scripts/notification-worker.ts']);
 });
 it.each([undefined,'','__proto__','constructor','toString','../scripts/worker.ts','chapa; command','Chapa'])('rejects non-allowlisted service name %j',name=>{
  expect(()=>serviceCommand(name)).toThrow('Choose web, bot, auctions, notifications, or chapa');
 });
 it('does not allow a caller to modify the next service invocation',()=>{
  const first=serviceCommand('chapa');first.push('--unexpected');
  expect(serviceCommand('chapa')).toEqual(['--import','tsx','scripts/chapa-worker.ts']);
 });
});
