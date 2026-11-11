import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {CHAPA_V1_INLINE_SCRIPT,chapaV1InlineOptions,startChapaV1Inline,type ChapaV1InlineConfig} from '../src/lib/chapa-v1-inline';
const base:ChapaV1InlineConfig={publicKey:'CHAPUBK_TEST_fixture',txRef:'LWv1-owned-001',amount:'50.00',currency:'ETB',phone:'+251911223344',paymentMethod:'telebirr'};
const disposers:Array<()=>void>=[];
afterEach(()=>{disposers.splice(0).forEach(fn=>fn());vi.unstubAllGlobals()});

function browser(){
 let script:any,frame:any,options:any;
 const click=vi.fn(),remove=vi.fn(),container:any={id:''};
 const child={ChapaCheckout:class{constructor(value:any){options=value}initialize(){}}};
 const doc:any={body:{appendChild:vi.fn()},head:{appendChild:(value:any)=>{script=value}},createElement:(tag:string)=>tag==='div'?container:{},getElementById:()=>({tagName:'BUTTON',click})};
 vi.stubGlobal('document',{body:{appendChild:(value:any)=>{frame=value}},createElement:()=>({style:{},setAttribute:vi.fn(),contentWindow:child,contentDocument:doc,remove})});
 return {click,remove,child,doc,get frame(){return frame},get script(){return script},get options(){return options},load(){frame.onload();script.onload()}};
}
describe('Chapa v1 official Inline adapter',()=>{
 it('pins the inspected browser artifact rather than assuming the documented default import',()=>{
  const source=readFileSync(new URL('../public/vendor/chapa-inline-v1.c9e7f64f.js',import.meta.url));
  expect(createHash('sha256').update(source).digest('hex')).toBe('c9e7f64f4f443bfa068cfc8d93bda9d160f5cb89bdb3501c74c3d66eacd1f27d');
  const window:any={};runInNewContext(source.toString(),{window});
  const sdk=new window.ChapaCheckout({publicKey:base.publicKey,amount:base.amount,tx_ref:base.txRef,availablePaymentMethods:['telebirr']});
  expect(sdk.options.tx_ref).toBe(base.txRef);expect(sdk.options.amount).toBe('50.00');expect(sdk.paymentType).toBe('telebirr');
  expect(sdk.destroy).toBeUndefined();expect(sdk.options.availablePaymentMethods).toEqual(['telebirr']);
 });
 it.each(['0911223344','911223344','251911223344','+251911223344'])('preserves merchant reference and normalizes %s to SDK national format',phone=>{
  const result=chapaV1InlineOptions({...base,phone});expect(result.mobile).toBe('911223344');expect(result.tx_ref).toBe(base.txRef);expect(result.availablePaymentMethods).toEqual(['telebirr']);expect(result).not.toHaveProperty('callbackUrl');expect(result).not.toHaveProperty('returnUrl');
 });
 it('rejects incompatible/unsupported prefixes before SDK initialization',()=>{
  for(const phone of ['0211223344','251251911223344','+251711223344'])expect(()=>chapaV1InlineOptions({...base,phone})).toThrow();
  expect(chapaV1InlineOptions({...base,paymentMethod:'mpesa',phone:'+251711223344'}).mobile).toBe('711223344');
  expect(()=>chapaV1InlineOptions({...base,paymentMethod:'mpesa',phone:'0911223344'})).toThrow();
  expect(()=>chapaV1InlineOptions({...base,txRef:''})).toThrow();expect(()=>chapaV1InlineOptions({...base,amount:'5e1'})).toThrow();expect(()=>chapaV1InlineOptions({...base,publicKey:'CHASECK_TEST-private'})).toThrow();
 });
 it('treats both success and failure callbacks as reconciliation hints only',()=>{
  const onSignal=vi.fn(),onFailure=vi.fn(),options=chapaV1InlineOptions(base,{onSignal,onFailure});
  options.onSuccessfulPayment();options.onPaymentFailure();options.onClose();
  expect(onSignal.mock.calls).toEqual([['provider_response'],['closed']]);expect(onFailure.mock.calls).toEqual([['provider_response']]);
 });
 it('loads one instance and clicks the SDK-rendered Pay only once, then tears down the whole realm',()=>{
  const b=browser(),onSignal=vi.fn(),payment=startChapaV1Inline({...base,txRef:'LWv1-once'},{onSignal});disposers.push(payment.dispose);
  expect(b.click).not.toHaveBeenCalled();expect(()=>startChapaV1Inline({...base,txRef:'LWv1-other'})).toThrow('INSTANCE_ACTIVE');
  b.load();expect(b.script.src).toBe(CHAPA_V1_INLINE_SCRIPT);expect(b.options.tx_ref).toBe('LWv1-once');expect(b.click).toHaveBeenCalledTimes(1);expect(onSignal).toHaveBeenCalledWith('started');
  payment.dispose();expect(b.remove).toHaveBeenCalledTimes(1);expect(()=>startChapaV1Inline({...base,txRef:'LWv1-once'})).toThrow('ORIGINAL_ATTEMPT_REQUIRES_VERIFICATION');
  b.options.onSuccessfulPayment();expect(onSignal).toHaveBeenCalledTimes(1);
 });
 it('ignores a late artifact load after closing and never dispatches it',()=>{
  const b=browser(),payment=startChapaV1Inline({...base,txRef:'LWv1-closed-before-script'});disposers.push(payment.dispose);b.frame.onload();const loaded=b.script.onload;payment.dispose();loaded();expect(b.click).not.toHaveBeenCalled();
 });
 it('allows an explicit retry of an artifact that failed before dispatch, without a false payment failure',()=>{
  const b=browser(),onFailure=vi.fn(),payment=startChapaV1Inline({...base,txRef:'LWv1-load-failure'},{onFailure});disposers.push(payment.dispose);b.frame.onload();b.script.onerror();expect(onFailure).toHaveBeenCalledWith('load');expect(b.click).not.toHaveBeenCalled();
  const next=startChapaV1Inline({...base,txRef:'LWv1-load-failure'});disposers.push(next.dispose);
 });
});
