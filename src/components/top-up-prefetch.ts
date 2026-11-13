'use client';
import type {ChapaCheckoutConfig} from '@/lib/chapa-client';
import {isPrivateQueryIdentity,loadPrivateJson,readPrivateQuery} from './private-query-cache';

export const TOP_UP_CONFIG_URL='/api/payments/chapa/inline/config';
export const TOP_UP_CONFIG_FRESH_MS=60000;
export const TOP_UP_PRESETS=['10','50','100','200','500','1000'] as const;

export function topUpConfigFreshness(config:ChapaCheckoutConfig|null|undefined){return config?.enabled&&config.methods.length?TOP_UP_CONFIG_FRESH_MS:5000}
/** Read-only intent warming; never initializes or retries a payment. */
export function loadTopUpConfiguration(identity:string,{force=false}={}){
 const current=readPrivateQuery<ChapaCheckoutConfig>(identity,TOP_UP_CONFIG_URL,{freshnessMs:TOP_UP_CONFIG_FRESH_MS});
 return loadPrivateJson<ChapaCheckoutConfig>(identity,TOP_UP_CONFIG_URL,{force,freshnessMs:topUpConfigFreshness(current?.value)});
}
export function warmTopUpConfiguration(identity:string|null){
 if(!isPrivateQueryIdentity(identity))return;
 void loadTopUpConfiguration(identity!).catch(()=>{/* The open sheet owns visible recovery. */});
}
