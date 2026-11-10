import {describe,it,expect} from 'vitest';
import {QueryClient} from '@tanstack/react-query';
import {createResumeGate} from '../src/lib/query-resume';
import {miniQueryPolicy} from '../src/components/mini-query-policy';
import {retainPaymentRetryDraft,readPaymentRetryDraft} from '../src/lib/payment-retry-draft';
describe('private history refresh and editable retry memory',()=>{
 it('coalesces staggered foreground events but permits a later genuine resume',()=>{const allowed=createResumeGate();expect(allowed(0)).toBe(true);expect(allowed(180)).toBe(false);expect(allowed(360)).toBe(false);expect(allowed(1001)).toBe(true)});
 it('keeps wallet freshness short and history finite and separate',()=>{expect(miniQueryPolicy('/api/wallet')).toMatchObject({staleMs:5000,refreshOnResume:true});expect(miniQueryPolicy('/api/transactions?page=2')).toMatchObject({staleMs:30000,retainMs:600000,refreshOnResume:false});expect(miniQueryPolicy('/api/payments/chapa/checkouts?page=1').staleMs).toBe(30000);expect(miniQueryPolicy('/api/payments/chapa/checkouts/owned-id').staleMs).toBe(5000)});
 it('retains only editable draft data per account, bounds entries and follows private logout clearing',()=>{const client=new QueryClient(),intent={key:'retry-draft',purpose:'TOP_UP' as const,amount:'100',paymentMethod:'telebirr',phone:'251911000000'};for(let n=0;n<23;n++)retainPaymentRetryDraft(client,'a',String(n),intent);expect(client.getQueryCache().getAll()).toHaveLength(20);expect(readPaymentRetryDraft(client,'b','22')).toBeNull();expect(readPaymentRetryDraft(client,'a','22')).toEqual(intent);client.removeQueries({queryKey:['lowin-private','a']});expect(readPaymentRetryDraft(client,'a','22')).toBeNull();client.clear()});
});
