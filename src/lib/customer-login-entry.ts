import {miniReturnPath} from './mini-return';

/** An authentication handoff names a customer route, never another origin/API/admin. */
export function customerLoginPath(next:string|null|undefined){
 const destination=miniReturnPath(next),query=new URLSearchParams({login:'1'});
 if(destination!=='/')query.set('next',destination);
 return '/?'+query.toString();
}
export function customerLoginRequest(params:URLSearchParams){
 if(params.getAll('login').length!==1||params.get('login')!=='1'||params.getAll('next').length>1)return null;
 return {destination:miniReturnPath(params.get('next'))};
}
export function withoutCustomerLogin(href:string){
 const url=new URL(href,'https://lowwin.invalid');
 url.searchParams.delete('login');url.searchParams.delete('next');
 return url.pathname+url.search+url.hash;
}
