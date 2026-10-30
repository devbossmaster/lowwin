import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AdminError} from '../src/modules/admin/errors';
import {z} from 'zod';
const f=vi.hoisted(()=>({read:vi.fn(),admin:vi.fn(),ops:vi.fn(),origin:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/admin/operations',()=>({adminRead:f.read,adminMutation:f.admin}));
vi.mock('../src/modules/admin/ops',()=>({opsMutation:f.ops}));
vi.mock('../src/modules/admin/boundary',()=>({adminHeaders:{'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'}}));
vi.mock('../src/modules/auth/private-api',async importOriginal=>({...await importOriginal<typeof import('../src/modules/auth/private-api')>(),requireMutationOrigin:f.origin}));
import {GET,POST} from '../src/app/api/admin/[...path]/route';
const request=()=>new Request('https://lowwin.test/api/admin/command',{method:'POST',headers:{'Content-Type':'application/json',cookie:'private-cookie-sentinel'},body:JSON.stringify({action:'broadcast',input:{text:'private-broadcast-sentinel'}})});
const failure=(code:string)=>Object.assign(Error('postgresql://private-password-sentinel'),{name:'PrismaClientKnownRequestError',code,meta:{private:'private-metadata-sentinel'}});
beforeEach(()=>{vi.resetAllMocks();vi.spyOn(console,'error').mockImplementation(()=>{})});
afterEach(()=>vi.restoreAllMocks());
describe('safe admin command failure diagnostics',()=>{
 it.each(['P2021','P2022'])('identifies a runtime schema mismatch (%s) without exposing database details',async code=>{
  f.ops.mockRejectedValue(failure(code));const response=await POST(request(),{params:Promise.resolve({path:['command']})}),body=await response.json();
  expect(response.status).toBe(503);expect(body.code).toBe('ADMIN_SCHEMA_NOT_READY');expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);expect(response.headers.get('cache-control')).toContain('no-store');
  expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0][0]))).toEqual({event:'admin_request_error',traceId:body.traceId,method:'POST',action:'broadcast',code,kind:'PrismaClientKnownRequestError'});
  expect(JSON.stringify(body)+JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-');expect(f.origin).toHaveBeenCalledOnce();expect(f.ops).toHaveBeenCalledOnce();
 });
 it.each(['P2028','P2024'])('distinguishes a transaction/pool timeout (%s) without retrying the broadcast',async code=>{
  f.ops.mockRejectedValue(failure(code));const response=await POST(request(),{params:Promise.resolve({path:['command']})});
  expect((await response.json()).code).toBe('ADMIN_REQUEST_TIMEOUT');expect(f.ops).toHaveBeenCalledOnce();
 });
 it('uses the same safe diagnostic for failed admin reads',async()=>{
  f.read.mockRejectedValue(failure('P1001'));const response=await GET(new Request('https://lowwin.test/api/admin/notifications'),{params:Promise.resolve({path:['notifications']})});
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:'Admin information is temporarily unavailable.',traceId:expect.any(String)});expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0][0])).method).toBe('GET');
 });
 it.each([new AdminError(403,'Administrator permission required.'),new z.ZodError([])])('preserves expected validation and authorization errors',async error=>{
  f.ops.mockRejectedValue(error);const response=await POST(request(),{params:Promise.resolve({path:['command']})});
  expect(response.status).toBe(error instanceof AdminError?403:422);expect(console.error).not.toHaveBeenCalled();
 });
 it('never includes arbitrary error properties in its diagnostics',async()=>{
  f.ops.mockRejectedValue({name:'private-name',code:'private-code',message:'private-message'});await POST(request(),{params:Promise.resolve({path:['command']})});
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-');
 });
});
