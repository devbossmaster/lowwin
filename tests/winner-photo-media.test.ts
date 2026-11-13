import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({cached:vi.fn(),store:vi.fn(),product:vi.fn(),presentation:vi.fn(),winner:vi.fn(),media:vi.fn(),admin:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{productImage:{findFirst:f.product},auction:{findFirst:f.presentation},managedMedia:{findFirst:f.winner,findUnique:f.media}}}));
vi.mock('../src/modules/admin/boundary',()=>({adminHeaders:{'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'},requireAdmin:f.admin}));
vi.mock('../src/modules/media/published-cache',()=>({readPublishedMedia:f.cached,storePublishedMedia:f.store}));
import {GET} from '../src/app/api/media/[id]/route';
const id='10000000-1111-4222-8333-444444444444',bytes=Uint8Array.from([137,80,78,71]);
const read=(value=id)=>GET(new Request(`https://lowwin.test/api/media/${value}`),{params:Promise.resolve({id:value})});
beforeEach(()=>{vi.resetAllMocks();f.cached.mockResolvedValue(null);f.product.mockResolvedValue(null);f.presentation.mockResolvedValue(null);f.winner.mockResolvedValue(null);f.media.mockResolvedValue({bytes,purpose:'CATALOG'});f.admin.mockRejectedValue(Error('Not staff'))});
describe('consented announcement media delivery',()=>{
 it('keeps existing frozen product images on their immutable cache fast path',async()=>{
  f.cached.mockResolvedValue(bytes);const response=await read();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('immutable');expect(f.product).not.toHaveBeenCalled();expect(f.winner).not.toHaveBeenCalled();
 });
 it('caches newly public product images without treating them as winner-only media',async()=>{
  f.product.mockResolvedValue({id:'product-image'});const response=await read();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('immutable');expect(f.winner).not.toHaveBeenCalled();expect(f.store).toHaveBeenCalledWith(id,bytes);
 });
 it('serves a currently consented genuine public winner photo without shared caching',async()=>{
  f.winner.mockResolvedValue({bytes,mime:'image/png'});const response=await read();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(f.store).not.toHaveBeenCalled();expect(f.admin).not.toHaveBeenCalled();
  const where=f.winner.mock.calls[0][0].where;expect(where.id).toBe(id);const photo=where.OR[0];expect(photo.purpose).toBe('WINNER_PHOTO');expect(photo.winnerPresentations.some.consentConfirmedAt.lte).toBeInstanceOf(Date);
  expect(photo.winnerPresentations.some.auction.is.AND[1]).toMatchObject({status:'CLOSED',isDemo:false,testRunId:null,settlement:{is:{outcome:'WINNER',winnerUserId:{not:null}}}});
  expect(photo.winnerPresentations.some.auction.is.AND[0]).toMatchObject({product:{is:{visible:true,category:{visible:true}}},category:{is:{visible:true}}});
  expect(photo.winnerPresentations.some.presentationMode).toBe('PHOTO');
 });
 it('serves complete Winners banners as revocable WebP, never as permanent product media',async()=>{
  f.winner.mockResolvedValueOnce({bytes,mime:'image/webp'});const response=await read();
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('image/webp');expect(response.headers.get('cache-control')).toContain('private, no-store');expect(f.store).not.toHaveBeenCalled();
  const where=f.winner.mock.calls[0][0].where.OR[1];expect(where.purpose).toBe('WINNER_BANNER');expect(where.winnerBannerPresentations.some.presentationMode).toBe('BANNER');expect(where.winnerBannerPresentations.some.bannerConsentConfirmedAt.lte).toBeInstanceOf(Date);expect(f.winner).toHaveBeenCalledTimes(1);
 });
 it('denies a removed/unconsented/unpublished photo instead of serving its retained bytes',async()=>{
  const response=await read();expect(response.status).toBe(404);expect(response.headers.get('cache-control')).toContain('no-store');expect(f.media).not.toHaveBeenCalled();expect(f.store).not.toHaveBeenCalled();
 });
 it('keeps unpublished administrator previews private and authorized',async()=>{
  f.admin.mockResolvedValue({role:'OWNER'});const response=await read();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private');expect(f.admin).toHaveBeenCalledWith(expect.anything(),expect.anything(),{permission:'catalog'});expect(f.store).not.toHaveBeenCalled();
 });
 it('refuses immutable delivery if an invalid catalog link points at winner-only media',async()=>{
  f.product.mockResolvedValue({id:'invalid-link'});f.media.mockResolvedValue({bytes,purpose:'WINNER_PHOTO'});
  const response=await read();expect(response.status).toBe(404);expect(response.headers.get('cache-control')).toContain('no-store');expect(f.store).not.toHaveBeenCalled();
 });
 it.each(['WINNER_PHOTO','WINNER_BANNER'])('rejects a forged public presentation link to %s without caching it',async purpose=>{
  f.presentation.mockResolvedValue({id:'invalid-presentation'});f.media.mockResolvedValue({bytes,purpose});
  const response=await read();expect(response.status).toBe(404);expect(response.headers.get('cache-control')).toContain('no-store');expect(f.store).not.toHaveBeenCalled();
 });
 it('limits unpublished winner-only previews to currently authorized administrators',async()=>{
  f.media.mockResolvedValue({bytes,purpose:'WINNER_PHOTO'});f.admin.mockResolvedValue({role:'CATALOG_MANAGER'});expect((await read()).status).toBe(404);
  f.admin.mockResolvedValue({role:'OWNER'});const shown=await read();expect(shown.status).toBe(200);expect(shown.headers.get('cache-control')).toContain('no-store');expect(f.store).not.toHaveBeenCalled();
 });
 it('requires owner access for private full-banner previews too',async()=>{
  f.media.mockResolvedValue({bytes,purpose:'WINNER_BANNER',mime:'image/webp'});f.admin.mockResolvedValue({role:'CATALOG_MANAGER'});expect((await read()).status).toBe(404);
  f.admin.mockResolvedValue({role:'OWNER'});const shown=await read();expect(shown.status).toBe(200);expect(shown.headers.get('content-type')).toBe('image/webp');expect(f.store).not.toHaveBeenCalled();
 });
 it('rejects a malformed media identifier before database or authentication calls',async()=>{
  expect((await read('../../secret')).status).toBe(404);expect(f.product).not.toHaveBeenCalled();expect(f.admin).not.toHaveBeenCalled();
 });
});
