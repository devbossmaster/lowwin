import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {resolveChapaReturn} from '../src/lib/chapa-return-resolution';
import {loadPrivateJson,readPrivateQuery,setPrivateQueryIdentity} from '../src/components/private-query-cache';

const identity='return-owner:session',id='0f55aaab-2222-4444-8888-123456789012';
const order={id,purpose:'TOP_UP',auctionSlug:null,status:'PENDING'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{setPrivateQueryIdentity(identity);vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(order)))});
afterEach(()=>{setPrivateQueryIdentity(null);vi.unstubAllGlobals()});

describe('direct owned Chapa return resolution',()=>{
 it('restores the top-up directly and reuses the same owned read in its modal',async()=>{
  expect(await resolveChapaReturn(identity,id)).toBe(`/profile?topup=1&chapa=${id}#wallet`);
  const url=`/api/payments/chapa/checkouts/${id}`;
  expect(await loadPrivateJson(identity,url,{freshnessMs:5000})).toEqual(order);
  expect(readPrivateQuery(identity,url,{freshnessMs:5000})?.value).toEqual(order);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({cache:'no-store'});
  expect(vi.mocked(fetch).mock.calls[0][1]).not.toHaveProperty('method','POST');
 });
 it('deduplicates concurrent return readers without creating or verifying a payment',async()=>{
  expect(await Promise.all([resolveChapaReturn(identity,id),resolveChapaReturn(identity,id)])).toEqual([`/profile?topup=1&chapa=${id}#wallet`,`/profile?topup=1&chapa=${id}#wallet`]);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('chooses the original auction only from the owned response',async()=>{
  vi.mocked(fetch).mockResolvedValue(response({...order,purpose:'BID',auctionSlug:'original-product'}));
  expect(await resolveChapaReturn(identity,id)).toBe(`/auctions/original-product?chapa=${id}#bid-review`);
 });
 it('rejects augmented payment identifiers before making a request',async()=>{
  await expect(resolveChapaReturn(identity,id+'&status=SUCCESS')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects a stale account identity before making a request',async()=>{
  await expect(resolveChapaReturn('other-session',id)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
 });
 it('drops a late owned response after an account change',async()=>{
  let complete!:(value:Response)=>void;
  vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{complete=resolve}));
  const result=resolveChapaReturn(identity,id),rejected=expect(result).rejects.toThrow();
  await Promise.resolve();setPrivateQueryIdentity('different-owner:session');
  complete(response(order));await rejected;
  expect(readPrivateQuery('different-owner:session',`/api/payments/chapa/checkouts/${id}`)).toBeNull();
 });
 it('rejects an unrelated checkout returned for the requested identifier',async()=>{
  vi.mocked(fetch).mockResolvedValue(response({...order,id:'0f55aaab-2222-4444-8888-123456789099'}));
  await expect(resolveChapaReturn(identity,id)).rejects.toThrow('Payment not found.');
 });
 it('keeps ownership failures as errors rather than redirecting or confirming funds',async()=>{
  vi.mocked(fetch).mockResolvedValue(response({error:'Payment not found.'},404));
  await expect(resolveChapaReturn(identity,id)).rejects.toThrow('Payment not found.');
 });
});
