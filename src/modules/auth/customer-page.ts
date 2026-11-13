import {cache} from 'react';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {customerLoginPath} from '@/lib/customer-login-entry';
import {getMiniSession,localMiniPreview} from './mini-access';

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
