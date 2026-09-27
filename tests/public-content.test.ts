import {beforeEach,describe,it,expect,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());vi.mock('../src/lib/db',()=>({db:{siteContent:{findUnique:query}}}));
import {publicHomeContent,publicFaqContent} from '../src/modules/admin/public-content';
describe('optional Phase 5A public content',()=>{
 beforeEach(()=>{query.mockReset()});
 it('retains existing Home and FAQ defaults on a database without SiteContent',async()=>{
  query.mockRejectedValue({code:'P2021',meta:{modelName:'SiteContent',table:'public.SiteContent'}});expect(await publicHomeContent()).toBeNull();expect(await publicFaqContent()).toEqual([]);
 });
 it('uses validated managed content when the migration exists',async()=>{
  query.mockResolvedValueOnce({body:{headline:'Managed headline',lead:'Managed introduction'}}).mockResolvedValueOnce({body:{items:[{question:'Question',answer:'Answer'}]}});expect(await publicHomeContent()).toEqual({headline:'Managed headline',lead:'Managed introduction'});expect(await publicFaqContent()).toEqual([{question:'Question',answer:'Answer'}]);
 });
 it('does not conceal connection failures or unrelated missing tables',async()=>{
  for(const failure of [{code:'P1001'},{code:'P2021',meta:{modelName:'Product',table:'public.Product'}}]){query.mockRejectedValue(failure);await expect(publicHomeContent()).rejects.toEqual(failure)}
 });
});
