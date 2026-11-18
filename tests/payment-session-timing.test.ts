import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({session:vi.fn(),limit:vi.fn(),preview:vi.fn()}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:f.session,localMiniPreview:f.preview}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> 'fixture-bot'}));
vi.mock('../src/modules/auth/private-api',()=>({limitUserMutation:f.limit,PrivateApiError:class extends Error{constructor(public status:number,message:string){super(message)}}}));
import {requirePaymentSession,requirePaymentSessionWithRead} from '../src/modules/payments/session';
import {timedChapaResponse} from '../src/modules/payments/chapa-timing';

beforeEach(()=>{
 vi.resetAllMocks();f.session.mockResolvedValue({user:{id:'owned-user'},telegramId:'fixture-telegram',session:{id:'private-session',token:'private-token',telegramAuthSource:'MINI_APP'}});f.limit.mockResolvedValue(undefined);f.preview.mockReturnValue(false);
});
afterEach(()=>vi.restoreAllMocks());

describe('payment session timing boundary',()=>{
 it('times the fresh session and unchanged mutation limiter separately without emitting their inputs',async()=>{
  const request=new Request('https://lowwin.test/api/payments/chapa/direct/current',{method:'POST',headers:{cookie:'private-cookie'}});
  const response=await timedChapaResponse(async()=>{expect(await requirePaymentSession(request)).toMatchObject({userId:'owned-user',reauthorize:expect.any(Function)});return Response.json({ok:true})});
  expect(f.session).toHaveBeenCalledExactlyOnceWith(request.headers);expect(f.limit).toHaveBeenCalledExactlyOnceWith(request,'owned-user');
  expect(response.headers.get('Server-Timing')).toMatch(/^auth_session;dur=\d+\.\d, auth_limit;dur=\d+\.\d, total;dur=\d+\.\d$/);
  expect(response.headers.get('Server-Timing')).not.toMatch(/owned-user|private|fixture/);
 });
 it('does not bypass a limiter rejection after a valid session',async()=>{
  const error=Object.assign(Error('Too many requests'),{status:429});f.limit.mockRejectedValueOnce(error);
  await expect(requirePaymentSession(new Request('https://lowwin.test/api/payments/chapa/direct/current',{method:'POST'}))).rejects.toBe(error);expect(f.limit).toHaveBeenCalledOnce();
 });
 it('rejects a missing session before the mutation limiter or transaction authorizer',async()=>{
  f.session.mockResolvedValueOnce(null);await expect(requirePaymentSession(new Request('https://lowwin.test/api/payments/chapa/direct/current',{method:'POST'}))).rejects.toMatchObject({status:401});expect(f.limit).not.toHaveBeenCalled();
 });
 it('exposes the fused capability only for an authenticated non-preview binding',async()=>{
  expect((await requirePaymentSession(new Request('https://lowwin.test/pay'))).reauthorize.forCurrentDirectCreate).toEqual(expect.any(Function));
  f.preview.mockReturnValue(true);f.session.mockResolvedValueOnce({user:{id:'lowin-local-test-user'},telegramId:null,session:{id:'local-session',token:'local-token',telegramAuthSource:'MINI_APP'}});
  expect((await requirePaymentSession(new Request('https://lowwin.test/pay'))).reauthorize.forCurrentDirectCreate).toBeUndefined();
 });
 it('starts owned read-only preparation while the quota is pending and cannot return it before quota acceptance',async()=>{
  let release!:()=>void;f.limit.mockReturnValueOnce(new Promise<void>(resolve=>{release=resolve}));const read=vi.fn(async(userId:string)=>({owner:userId,replay:null}));let settled=false;
  const pending=requirePaymentSessionWithRead(new Request('https://lowwin.test/pay',{method:'POST'}),read);void pending.then(()=>{settled=true});
  await vi.waitFor(()=>expect(read).toHaveBeenCalledExactlyOnceWith('owned-user'));expect(f.limit).toHaveBeenCalledOnce();expect(settled).toBe(false);release();
  const result=await pending;expect(result).toMatchObject({userId:'owned-user',prepared:{owner:'owned-user',replay:null}});expect(result.reauthorize.forCurrentDirectCreate).toEqual(expect.any(Function));
 });
 it('keeps limiter rejection ahead of an earlier rejected read and waits for the quota decision',async()=>{
  const rejected=Object.assign(Error('Quota rejected'),{status:429}),readError=Error('Read failed');let rejectLimit!:(error:Error)=>void;
  f.limit.mockReturnValueOnce(new Promise((_resolve,reject)=>{rejectLimit=reject}));const read=vi.fn(async()=>{throw readError});let settled=false;
  const outcome=requirePaymentSessionWithRead(new Request('https://lowwin.test/pay',{method:'POST'}),read).then(value=>{settled=true;return value},error=>{settled=true;return error});
  await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());expect(settled).toBe(false);rejectLimit(rejected);expect(await outcome).toBe(rejected);
 });
 it('returns a quota rejection without waiting for a slow read',async()=>{
  const rejected=Object.assign(Error('Quota rejected'),{status:429});f.limit.mockRejectedValueOnce(rejected);const read=vi.fn(()=>new Promise<never>(()=>{}));
  await expect(requirePaymentSessionWithRead(new Request('https://lowwin.test/pay',{method:'POST'}),read)).rejects.toBe(rejected);expect(read).toHaveBeenCalledOnce();
 });
 it.each(['async','sync'] as const)('propagates a %s read failure only after the unchanged limiter accepts',async kind=>{
  const error=Error('Owned read failed'),read=kind==='sync'?vi.fn(()=>{throw error}):vi.fn(async()=>{throw error});
  await expect(requirePaymentSessionWithRead(new Request('https://lowwin.test/pay',{method:'POST'}),read)).rejects.toBe(error);expect(f.limit).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledOnce();
 });
 it.each(['missing','unbound'] as const)('starts neither quota nor preparation for a %s identity',async kind=>{
  f.session.mockResolvedValueOnce(kind==='missing'?null:{user:{id:'owned-user'},telegramId:null,session:{id:'private-session',token:'private-token',telegramAuthSource:'MINI_APP'}});const read=vi.fn(async()=>null);
  await expect(requirePaymentSessionWithRead(new Request('https://lowwin.test/pay',{method:'POST'}),read)).rejects.toMatchObject({status:401});expect(f.limit).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
});
