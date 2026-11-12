import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
const f=vi.hoisted(()=>({pay:vi.fn(),read:vi.fn(),auth:vi.fn(),reauthorize:vi.fn(),db:{}}));
vi.mock('../src/lib/db',()=>({db:f.db}));
vi.mock('../src/modules/payments/session',()=>({requirePaymentSession:f.auth}));
vi.mock('../src/modules/auctions/batch',()=>({createAndPayBidBatchWallet:f.pay,getOwnWalletBidBatch:f.read,payBidBatchWallet:f.pay}));
import {POST,GET} from '../src/app/api/payments/chapa/batches/wallet/route';
import {GET as getById} from '../src/app/api/payments/chapa/batches/[id]/wallet/route';
import {ChapaError} from '../src/modules/payments/chapa-provider';
const origin='https://lowwin.test',key=randomUUID(),id=randomUUID(),quoteHash='a'.repeat(64),command={key,auctionSlug:'local-wallet-fixture',numbers:['2','9'],feeVersion:1,approvedTotal:'20.00'};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('BETTER_AUTH_URL',origin);f.auth.mockResolvedValue({userId:'owner',reauthorize:f.reauthorize});f.pay.mockResolvedValue({kind:'receipt',receipt:{batch:{id},wallet:{available:'5.00'},payment:{method:'wallet'}}});f.read.mockResolvedValue({kind:'pending',status:'PENDING',batchId:null,pollAfterMs:1000})});
afterEach(()=>vi.unstubAllEnvs());
describe('atomic internal wallet HTTP command and read-only observation',()=>{
 it('authenticates once and sends the original approved selection to one server command',async()=>{
  const response=await POST(new Request(origin+'/api/payments/chapa/batches/wallet',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(command)}));
  expect(response.status).toBe(200);expect(f.auth).toHaveBeenCalledOnce();expect(f.pay).toHaveBeenCalledExactlyOnceWith(f.db,'owner',command,f.reauthorize);expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('Server-Timing')).toContain('database;dur=');
 });
 it('returns a changed-price quote without pretending a receipt was committed',async()=>{
  f.pay.mockResolvedValue({kind:'quote',quote:{id,total:'21.00'}});const response=await POST(new Request(origin+'/api/payments/chapa/batches/wallet',{method:'POST',headers:{origin},body:JSON.stringify(command)}));
  expect(await response.json()).toEqual({kind:'quote',quote:{id,total:'21.00'}});
 });
 it('rejects cross-origin payment before invoking authorization or the debit command',async()=>{
  const response=await POST(new Request(origin+'/api/payments/chapa/batches/wallet',{method:'POST',headers:{origin:'https://elsewhere.test'},body:JSON.stringify(command)}));expect(response.status).toBe(403);expect(f.pay).not.toHaveBeenCalled();expect(f.auth).not.toHaveBeenCalled();
 });
 it('observes the same owned key with 202/retry feedback and never calls the debit command',async()=>{
  const response=await GET(new Request(origin+'/api/payments/chapa/batches/wallet?key='+key));
  expect(response.status).toBe(202);expect(response.headers.get('Retry-After')).toBe('1');expect(response.headers.get('Cache-Control')).toContain('no-store');expect(f.read).toHaveBeenCalledExactlyOnceWith(f.db,'owner',{key},f.reauthorize);expect(f.pay).not.toHaveBeenCalled();
 });
 it('returns only the committed owned receipt with 200 after a lost response',async()=>{
  const result={kind:'receipt',receipt:{payment:{method:'wallet',acceptedBidIds:['accepted']},wallet:{available:'5.00'}}};f.read.mockResolvedValue(result);const response=await GET(new Request(origin+'/api/payments/chapa/batches/wallet?key='+key));expect(response.status).toBe(200);expect(await response.json()).toEqual(result);expect(f.pay).not.toHaveBeenCalled();
 });
 it('binds an existing quote reader to its ID and hash without another charge',async()=>{
  const response=await getById(new Request(origin+'/api/payments/chapa/batches/'+id+'/wallet?quoteHash='+quoteHash),{params:Promise.resolve({id})});expect(response.status).toBe(202);expect(f.read).toHaveBeenCalledExactlyOnceWith(f.db,'owner',{id,quoteHash},f.reauthorize);expect(f.pay).not.toHaveBeenCalled();
 });
 it('cannot silently reinterpret an external payment as a wallet receipt',async()=>{f.read.mockRejectedValue(new ChapaError(409,'PAYMENT_STARTED','Check the original payment.'));const response=await GET(new Request(origin+'/api/payments/chapa/batches/wallet?key='+key));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'PAYMENT_STARTED'});expect(f.pay).not.toHaveBeenCalled()});
});
