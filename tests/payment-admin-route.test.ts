import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {AdminError} from '../src/modules/admin/errors';
import {PaymentError} from '../src/modules/payments/reference';

const mocks=vi.hoisted(()=>({read:vi.fn(),command:vi.fn(),statement:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{}}));
vi.mock('@/modules/payments/admin',()=>({paymentAdminRead:mocks.read,paymentAdminCommand:mocks.command,recordStatement:mocks.statement}));
import {GET} from '../src/app/api/admin/payments/[[...path]]/route';
const request=()=>new Request('https://lowwin.example/api/admin/payments/settings?private=private-sentinel',{headers:{cookie:'private-cookie-sentinel'}});
const context=()=>({params:Promise.resolve({path:['settings']})});
beforeEach(()=>{mocks.read.mockReset();vi.spyOn(console,'error').mockImplementation(()=>{})});
afterEach(()=>vi.restoreAllMocks());

describe('admin payment error diagnostics',()=>{
 it.each(['P2022','P1001'])('logs only a safe database code and request trace for %s',async code=>{
  mocks.read.mockRejectedValue(Object.assign(new Error('postgresql://private-password-sentinel; private-account-sentinel'),{name:'PrismaClientKnownRequestError',code,meta:{account:'private-account-sentinel'}}));
  const response=await GET(request(),context()),body=await response.json();
  expect(response.status).toBe(503);expect(body).toEqual({error:'Payment operations are unavailable.',traceId:expect.any(String)});
  expect(response.headers.get('cache-control')).toContain('no-store');
  const lines=vi.mocked(console.error).mock.calls.map(call=>String(call[0]));
  expect(lines).toHaveLength(1);expect(JSON.parse(lines[0])).toEqual({event:'payment_admin_error',traceId:body.traceId,method:'GET',name:'PrismaClientKnownRequestError',code});
  expect(lines.join('')).not.toContain('private-');expect(JSON.stringify(body)).not.toContain('private-');
 });
 it('does not log arbitrary error properties or messages',async()=>{
  mocks.read.mockRejectedValue({code:'private-code-sentinel',name:'private-name-sentinel',message:'private-message-sentinel'});
  const response=await GET(request(),context());expect(response.status).toBe(503);
  expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0][0]))).toMatchObject({code:'UNKNOWN',name:'Error'});
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-');
 });
 it.each([new AdminError(403,'Owner permission required.'),new PaymentError(409,'Configuration changed. Review again.'),new z.ZodError([])])('preserves expected permission and validation errors without diagnostic noise',async error=>{
  mocks.read.mockRejectedValue(error);const response=await GET(request(),context());
  expect(response.status).toBe(error instanceof z.ZodError?422:error.status);
  expect(await response.json()).toEqual({error:error instanceof z.ZodError?'Check the supplied fields.':error.message});
  expect(console.error).not.toHaveBeenCalled();
 });
});
