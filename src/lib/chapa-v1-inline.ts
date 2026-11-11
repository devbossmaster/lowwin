'use client';

import {normalizePaymentPhone,paymentPhoneProblem} from './payment-phone';

/** Unmodified official CDN artifact, downloaded and inspected 2026-11-11.
 * SHA-256: c9e7f64f4f443bfa068cfc8d93bda9d160f5cb89bdb3501c74c3d66eacd1f27d.
 * This CDN artifact is a browser global; the docs' ESM import is not its loader.
 */
export const CHAPA_V1_INLINE_SCRIPT='/vendor/chapa-inline-v1.c9e7f64f.js';
export const CHAPA_V1_INLINE_METHODS=['telebirr','cbebirr','mpesa','ebirr'] as const;
export type ChapaV1InlineMethod=typeof CHAPA_V1_INLINE_METHODS[number];
export type ChapaV1InlineConfig={publicKey:string;txRef:string;amount:string;currency:'ETB';phone:string;paymentMethod:ChapaV1InlineMethod};
export type ChapaV1InlineSignal='started'|'provider_response'|'closed';
export type ChapaV1InlineFailure='load'|'unsupported_artifact'|'provider_response';
type Callbacks={onSignal?:(signal:ChapaV1InlineSignal)=>void;onFailure?:(reason:ChapaV1InlineFailure)=>void};
type Options={publicKey:string;tx_ref:string;amount:string;currency:'ETB';mobile:string;availablePaymentMethods:ChapaV1InlineMethod[];showFlag:boolean;showPaymentMethodsNames:boolean;onSuccessfulPayment:()=>void;onPaymentFailure:()=>void;onClose:()=>void};
type InlineConstructor=new(options:Options)=>{initialize:(containerId:string)=>void};
type InlineWindow=Window&{ChapaCheckout?:InlineConstructor};
let active:HTMLIFrameElement|null=null;
const dispatchedReferences=new Set<string>();

export function chapaV1InlineOptions(config:ChapaV1InlineConfig,callbacks:Callbacks={}):Options{
 const phone=normalizePaymentPhone(config.phone);
 if(!phone||paymentPhoneProblem(phone,config.paymentMethod))throw Error('CHAPA_V1_PHONE_INVALID');
 if(!CHAPA_V1_INLINE_METHODS.includes(config.paymentMethod)||config.currency!=='ETB'||!/^\d+(?:\.\d{1,2})?$/.test(config.amount)||Number(config.amount)<=0||!Number.isFinite(Number(config.amount)))throw Error('CHAPA_V1_CONFIGURATION_INVALID');
 if(!config.txRef||config.txRef.length>100||!/^[-A-Za-z0-9_]+$/.test(config.txRef)||!/^CHAPUBK[_-]/.test(config.publicKey)||config.publicKey.length>200||/[\s<>]/.test(config.publicKey))throw Error('CHAPA_V1_CONFIGURATION_INVALID');
 return {publicKey:config.publicKey,tx_ref:config.txRef,amount:config.amount,currency:config.currency,mobile:phone.slice(3),availablePaymentMethods:[config.paymentMethod],showFlag:true,showPaymentMethodsNames:true,
  // SDK callbacks are hints only, including its so-called failure callback which
  // also runs after network errors. Only the owned server verifier settles money.
  onSuccessfulPayment:()=>callbacks.onSignal?.('provider_response'),
  onPaymentFailure:()=>callbacks.onFailure?.('provider_response'),
  onClose:()=>callbacks.onSignal?.('closed')};
}

/** Call only after explicit Pay and after persisting the immutable owned intent.
 * Uses the documented initialize + SDK-rendered Pay button, never private gateway
 * methods. The SDK has fixed global IDs, a polling loop and no destroy API: a
 * dedicated browsing context contains all of them and is removed on disposal.
 * No callback/return URL is passed: the SDK would redirect or send its internal
 * provider ref_id as tx_ref. Lowwin reconciles its original stored tx_ref instead.
 */
export function startChapaV1Inline(config:ChapaV1InlineConfig,callbacks:Callbacks={}):{dispose:()=>void}{
 if(typeof document==='undefined')throw Error('CHAPA_V1_BROWSER_REQUIRED');
 const options=chapaV1InlineOptions(config,callbacks);
 if(active)throw Error('CHAPA_V1_INSTANCE_ACTIVE');
 if(dispatchedReferences.has(config.txRef))throw Error('CHAPA_V1_ORIGINAL_ATTEMPT_REQUIRES_VERIFICATION');
 const frame=document.createElement('iframe');
 frame.title='Lowwin payment connection';frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
 frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0;pointer-events:none';
 let disposed=false;
 function dispose(){if(disposed)return;disposed=true;frame.onload=null;frame.remove();if(active===frame)active=null}
 function failure(reason:ChapaV1InlineFailure){if(!disposed)callbacks.onFailure?.(reason)}
 frame.onload=()=>{
  if(disposed)return;
  frame.onload=null;
  const child=frame.contentWindow as InlineWindow|null,doc=frame.contentDocument;
  if(!child||!doc){failure('load');dispose();return}
  const container=doc.createElement('div');container.id='lowwin-chapa-inline';doc.body.appendChild(container);
  const script=doc.createElement('script');script.src=CHAPA_V1_INLINE_SCRIPT;script.async=true;
  script.onerror=()=>{failure('load');dispose()};
  script.onload=()=>{
   if(disposed)return;
   try{
    const Constructor=child.ChapaCheckout;
    if(typeof Constructor!=='function'){failure('unsupported_artifact');dispose();return}
    const sdk=new Constructor({...options,onSuccessfulPayment:()=>{if(!disposed)options.onSuccessfulPayment()},onPaymentFailure:()=>{if(!disposed)options.onPaymentFailure()},onClose:()=>{if(!disposed)options.onClose()}});
    sdk.initialize(container.id);
    const button=doc.getElementById('chapa-pay-button');
    if(!button||button.tagName!=='BUTTON'){failure('unsupported_artifact');dispose();return}
    // Mark before click: a response can be interrupted after the provider accepts
    // it. Remounting the UI must never resend that SDK initialization.
    dispatchedReferences.add(config.txRef);
    callbacks.onSignal?.('started');
    (button as HTMLButtonElement).click();
   }catch{failure('unsupported_artifact');dispose()}
  };
  doc.head.appendChild(script);
 };
 frame.src='about:blank';active=frame;document.body.appendChild(frame);
 return {dispose};
}
