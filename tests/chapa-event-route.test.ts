import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({session:vi.fn(),read:vi.fn(),subscribe:vi.fn(),cleanup:vi.fn(),notify:null as null|(()=>void)}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:f.session}));
vi.mock('../src/modules/payments/chapa',()=>({getChapaCheckout:f.read}));
vi.mock('../src/modules/payments/chapa-committed',()=>({subscribeChapaCommitted:f.subscribe}));
import {GET} from '../src/app/api/payments/chapa/checkouts/[id]/events/route';
import {ChapaError} from '../src/modules/payments/chapa-provider';
const id='00000000-0000-4000-8000-000000000001',context={params:Promise.resolve({id})};
const session={user:{id:'owner'},session:{id:'session-a',expiresAt:new Date(Date.now()+600000)}};
const request=()=>{const abort=new AbortController();return {abort,request:new Request(`https://lowwin.test/api/payments/chapa/checkouts/${id}/events`,{signal:abort.signal,headers:{cookie:'signed-session-cookie'}})}};
const frame=async(reader:ReadableStreamDefaultReader<Uint8Array>)=>new TextDecoder().decode((await reader.read()).value);
beforeEach(()=>{vi.clearAllMocks();f.session.mockResolvedValue(session);f.read.mockResolvedValue({id,purpose:'TOP_UP',status:'PENDING'});f.subscribe.mockImplementation(async(_id:string,notify:()=>void)=>{f.notify=notify;return f.cleanup})});
afterEach(()=>vi.restoreAllMocks());
describe('owner-authenticated committed payment SSE route',()=>{
 it('rejects unsigned sessions before reading or subscribing',async()=>{
  f.session.mockResolvedValue(null);const r=request(),response=await GET(r.request,context);expect(response.status).toBe(401);expect(f.read).not.toHaveBeenCalled();expect(f.subscribe).not.toHaveBeenCalled();r.abort.abort();
 });
 it('cannot subscribe to another account payment',async()=>{
  f.session.mockResolvedValue({...session,user:{id:'different-owner'}});f.read.mockRejectedValue(new ChapaError(404,'NOT_FOUND','Payment not found.'));
  const r=request(),response=await GET(r.request,context);expect(response.status).toBe(404);expect(f.read).toHaveBeenCalledWith({},'different-owner',id);expect(f.subscribe).not.toHaveBeenCalled();r.abort.abort();
 });
 it('streams a fresh owned database DTO on every connection with private proxy headers',async()=>{
  const first=request(),response=await GET(first.request,context),reader=response.body!.getReader();
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('x-accel-buffering')).toBe('no');
  expect(await frame(reader)).toContain(': connected');expect(await frame(reader)).toContain('PENDING');expect(await frame(reader)).toContain('PENDING');
  first.abort.abort();expect(f.cleanup).toHaveBeenCalledOnce();
  f.read.mockResolvedValue({id,purpose:'TOP_UP',status:'CREDITED'});const second=request(),reconnected=await GET(second.request,context),nextReader=reconnected.body!.getReader();await frame(nextReader);expect(await frame(nextReader)).toContain('CREDITED');second.abort.abort();
 });
 it('rechecks the same bound session before every pushed DTO',async()=>{
  const r=request(),response=await GET(r.request,context),reader=response.body!.getReader();await frame(reader);await frame(reader);await frame(reader);
  f.session.mockResolvedValue({...session,session:{...session.session,id:'different-session'}});f.notify!();expect(await frame(reader)).toContain('authorization');expect((await reader.read()).done).toBe(true);expect(f.read).toHaveBeenCalledTimes(2);r.abort.abort();
 });
 it('does not open a stream for an already expired session',async()=>{
  f.session.mockResolvedValue({...session,session:{...session.session,expiresAt:new Date(Date.now()-1000)}});const r=request(),response=await GET(r.request,context);expect(response.status).toBe(401);expect(f.subscribe).not.toHaveBeenCalled();r.abort.abort();
 });
});
