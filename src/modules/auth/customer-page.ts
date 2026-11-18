import {cache} from 'react';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {customerLoginPath} from '@/lib/customer-login-entry';
import {getMiniSession,localMiniPreview} from './mini-access';
import {miniAccountFromSession} from './mini-account';
import type {BrowserAccountBootstrap} from '@/lib/current-account';

// Request-render memoization only: no authorization decision survives a request.
// Detail pages authorize before server reads as well as at the Proxy boundary.
const customerSession=cache(async()=>{
 const requestHeaders=await headers();
 if(localMiniPreview(requestHeaders))return {preview:true} as const;
 return getMiniSession(requestHeaders);
});
export async function requireCustomerPage(destination:string){
 const session=await customerSession();
 if(!session)redirect(customerLoginPath(destination));
 return session;
}

/** Share the live request-render lookup with any page that needs authorization.
 * The callback marker determines when to try this read, never who can sign in. */
export async function browserAccountBootstrap():Promise<BrowserAccountBootstrap>{
 try{
  const session=await customerSession();
  if(!session)return {kind:'guest'};
  if('preview' in session||session.session.telegramAuthSource!=='TELEGRAM_OIDC')return {kind:'client-check'};
  return {kind:'verified',account:miniAccountFromSession(session)};
 }catch{return {kind:'unavailable'}}
}
