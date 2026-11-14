import {createAuth} from './server';
import {browserLoginConfig,telegramLoginSettings,telegramLoginRequestOrigin,telegramLoginDestination,telegramLoginFailure,TELEGRAM_LOGIN_PROVIDER} from './telegram-login';

const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
/** HTTP boundary only: protocol state, PKCE, JWT validation and cookies belong
 * to the installed Telegram plugin and Better Auth's standard social routes. */
export async function handleTelegramOIDC(request:Request,path:string){
 if(path==='/telegram/config')return Response.json(browserLoginConfig(),{headers});
 const settings=telegramLoginSettings();
 if(!settings)return Response.json({error:'Telegram sign-in is not configured.'},{status:503,headers});
 if(!telegramLoginRequestOrigin(request,settings.origin))return Response.json({error:'Invalid login request.'},{status:400,headers});
 const callback=path==='/callback/'+TELEGRAM_LOGIN_PROVIDER;
 if(!callback){
  if(request.method!=='POST'||request.headers.get('origin')!==settings.origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
  let body:Record<string,unknown>;
  try{body=await request.json()}catch{return Response.json({error:'Invalid login request.'},{status:400,headers})}
  if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Invalid login request.'},{status:400,headers});
  const destination=telegramLoginDestination(body.callbackURL??'/',settings.origin);
  if(body.provider!==TELEGRAM_LOGIN_PROVIDER||!destination||Object.keys(body).some(key=>!['provider','callbackURL','errorCallbackURL','newUserCallbackURL','disableRedirect'].includes(key)))return Response.json({error:'Invalid login request.'},{status:400,headers});
  const errorUrl=new URL('/',settings.origin);errorUrl.searchParams.set('login','1');errorUrl.searchParams.set('next',destination);
  const proposed=telegramLoginDestination(body.errorCallbackURL,settings.origin);
  if(proposed){const lang=new URL(proposed,settings.origin).searchParams.get('lang');if(lang==='en'||lang==='am')errorUrl.searchParams.set('lang',lang)}
  const normalized={provider:TELEGRAM_LOGIN_PROVIDER,callbackURL:settings.origin+destination,newUserCallbackURL:settings.origin+destination,errorCallbackURL:errorUrl.href,disableRedirect:true};
  request=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(normalized)});
 }else{
  const query=new URL(request.url).searchParams;
  if(request.method!=='GET'||query.getAll('state').length!==1||query.getAll('code').length>1||query.getAll('error').length>1)return loginError(settings.origin,'invalid');
 }
 try{
  const response=await createAuth().handler(request),output=new Headers(response.headers);
  for(const [key,value]of Object.entries(headers))output.set(key,value);
  if(callback){
   const location=response.headers.get('location');
   if(!location){
    let code:string|null=null;
    try{const error=await response.json() as {code?:unknown};if(typeof error.code==='string')code=error.code}catch{}
    return loginError(settings.origin,telegramLoginFailure(code),output);
   }
   if(response.status>=500)return loginError(settings.origin,'unavailable',output);
   const target=new URL(location,settings.origin);
   if(target.origin!==settings.origin)return loginError(settings.origin,'invalid',output);
   if(target.searchParams.has('error')){
    const next=telegramLoginDestination(target.searchParams.get('next'),settings.origin)??'/';
    return loginError(settings.origin,telegramLoginFailure(target.searchParams.get('error')),output,next,target.searchParams.get('lang'));
   }
   if(!telegramLoginDestination(target.href,settings.origin))return loginError(settings.origin,'invalid',output);
   return new Response(null,{status:303,headers:output});
  }
  if(!response.ok)return Response.json({error:'Telegram sign-in is temporarily unavailable.'},{status:response.status===429?429:503,headers:output});
  const result=await response.json() as {url?:unknown};
  if(typeof result.url!=='string'||new URL(result.url).origin!=='https://oauth.telegram.org'||new URL(result.url).pathname!=='/auth')throw Error('Unexpected authorization destination');
  return Response.json({url:result.url,redirect:true},{headers:output});
 }catch{
  console.warn('telegram_login_unavailable',{stage:callback?'callback':'start',provider:TELEGRAM_LOGIN_PROVIDER});
  return callback?loginError(settings.origin,'unavailable'):Response.json({error:'Telegram sign-in is temporarily unavailable.'},{status:503,headers});
 }
}
function loginError(origin:string,code:string,existing?:Headers,next='/',language:string|null=null){
 const target=new URL('/',origin);target.searchParams.set('telegramLoginError',code);target.searchParams.set('next',next);if(language==='am'||language==='en')target.searchParams.set('lang',language);
 const output=new Headers(existing);for(const [key,value]of Object.entries(headers))output.set(key,value);output.set('Location',target.href);
 return new Response(null,{status:303,headers:output});
}
