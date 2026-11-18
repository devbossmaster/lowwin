import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({session:vi.fn(),limit:vi.fn()}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:f.session,localMiniPreview:()=>false}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> 'fixture-bot'}));
vi.mock('../src/modules/auth/private-api',()=>({limitUserMutation:f.limit,PrivateApiError:class extends Error{constructor(public status:number,message:string){super(message)}}}));
import {requirePaymentSession} from '../src/modules/payments/session';
import {timedChapaResponse} from '../src/modules/payments/chapa-timing';

beforeEach(()=>{
 vi.resetAllMocks();f.session.mockResolvedValue({user:{id:'owned-user'},telegramId:'fixture-telegram',session:{id:'private-session',token:'private-token',telegramAuthSource:'MINI_APP'}});f.limit.mockResolvedValue(undefined);
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
});
