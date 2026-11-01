import {beforeEach,describe,expect,it,vi} from 'vitest';
const read=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/db',()=>({db:{fixture:true}}));
vi.mock('../src/modules/admin/wallet-bid-payment',()=>({readWalletBidPayment:read}));
import {AdminError} from '../src/modules/admin/errors';
import {GET} from '../src/app/api/admin/payments/wallet-bids/[id]/route';
const request=new Request('https://lowwin.test/api/admin/payments/wallet-bids/owned-bid'),context={params:Promise.resolve({id:'owned-bid'})};
beforeEach(()=>vi.resetAllMocks());
describe('private wallet bid payment detail route',()=>{
 it('delegates authentication and the exact requested bid to the guarded read',async()=>{
  read.mockResolvedValue({item:{id:'owned-bid',paymentMethod:'Wallet',status:'BID_ACCEPTED'}});
  const response=await GET(request,context);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(read).toHaveBeenCalledWith({fixture:true},request.headers,'owned-bid');expect((await response.json()).item.paymentMethod).toBe('Wallet');
 });
 it.each([401,403,404,429])('preserves a guarded %s without revealing a record',async status=>{
  read.mockRejectedValue(new AdminError(status,'Payment unavailable.'));
  const response=await GET(request,context);expect(response.status).toBe(status);expect(await response.json()).toEqual({error:'Payment unavailable.'});
  expect(response.headers.get('cache-control')).toContain('no-store');
 });
 it('does not expose database or connection error details',async()=>{
  read.mockRejectedValue(Error('private database password and SQL'));
  const response=await GET(request,context);expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toMatch(/password|SQL/);
 });
});
