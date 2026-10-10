import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
vi.mock('@/lib/db',()=>({db:{}}));
import {paymentHttpError} from '../src/modules/payments/http-error';
import {PrivateApiError} from '../src/modules/auth/private-api';
import {PaymentError} from '../src/modules/payments/reference';

beforeEach(()=>vi.spyOn(console,'error').mockImplementation(()=>{}));
afterEach(()=>vi.restoreAllMocks());
describe('customer payment diagnostics',()=>{
  it.each(['list','submit','scan'] as const)('reports a safe correlated failure for %s',async operation=>{
    const error=Object.assign(new Error('private-receipt postgresql://private-password'),{name:'PrismaClientKnownRequestError',code:'P2028',meta:{query:'private-query'}});
    const response=paymentHttpError(error,operation,performance.now()),body=await response.json();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toEqual({error:'This information is temporarily unavailable.',traceId:expect.any(String)});
    expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0][0]))).toEqual({event:'payment_request_error',traceId:body.traceId,operation,code:'P2028',kind:'PrismaClientKnownRequestError',elapsedMs:expect.any(Number)});
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-');
    expect(JSON.stringify(body)).not.toContain('private-');
  });
  it('does not log arbitrary metadata, names or codes',()=>{
    paymentHttpError({name:'private-name',code:'private-code',message:'private-message',meta:{code:'private-state'}},'submit',performance.now());
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-');
  });
  it.each([new PaymentError(409,'Idempotency key changed.'),new PaymentError(503,'Verification unavailable.'),new PrivateApiError(401,'Sign in through Telegram.'),new z.ZodError([]),new SyntaxError('private-body')])('preserves expected errors without logging',async error=>{
    const response=paymentHttpError(error,'submit',performance.now());
    const status=error instanceof PaymentError||error instanceof PrivateApiError?error.status:422;
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({error:status===422?'Check the supplied fields.':error.message});
    expect(console.error).not.toHaveBeenCalled();
  });
});
