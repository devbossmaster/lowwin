import {describe,expect,it,vi} from 'vitest';
import {loadTelegramBrowserLoginConfiguration,requestTelegramBrowserLogin,telegramBrowserLoginDestination,telegramBrowserLoginError,telegramEnvironment} from '../src/lib/telegram-browser-login-client';

describe('browser Telegram login presentation and handoff',()=>{
 it('loads only public readiness booleans and ignores extra fields',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({enabled:true,configured:true,unexpected:'discard'}));
  expect(await loadTelegramBrowserLoginConfiguration(new AbortController().signal,transport)).toEqual({enabled:true,configured:true});
  expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0][0]).toBe('/api/auth/telegram/config');
 });
 it('bounds a stalled readiness fetch and supports a clean next retry',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementationOnce((_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))).mockResolvedValueOnce(Response.json({enabled:false,configured:false}));
  await expect(loadTelegramBrowserLoginConfiguration(new AbortController().signal,transport,15)).rejects.toMatchObject({name:'AbortError'});
  expect(await loadTelegramBrowserLoginConfiguration(new AbortController().signal,transport)).toEqual({enabled:false,configured:false});
 });
 it('cancels the readiness request when the login sheet closes',async()=>{
  const controller=new AbortController(),transport=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
  const request=loadTelegramBrowserLoginConfiguration(controller.signal,transport);controller.abort();await expect(request).rejects.toMatchObject({name:'AbortError'});
 });
 it.each([null,{}, {enabled:'true',configured:true}])('rejects malformed readiness %j',async value=>{
  await expect(loadTelegramBrowserLoginConfiguration(new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)))).rejects.toThrow('Configuration unavailable');
 });
 it('keeps SDK presence separate from a Mini App launch',()=>{
  expect(telegramEnvironment(undefined)).toBe('browser');expect(telegramEnvironment({})).toBe('browser');expect(telegramEnvironment({initData:''})).toBe('browser');expect(telegramEnvironment({initData:'signed-launch-data'})).toBe('mini');
 });
 it('preserves the customer destination and clears callback feedback from a new handoff',()=>{
  expect(telegramBrowserLoginDestination({pathname:'/',search:'?telegramLoginError=expired&next=%2Fauctions%2Fpower-bank%3Fsort%3Dsoon%23bid',hash:''})).toBe('/auctions/power-bank?sort=soon#bid');
  expect(telegramBrowserLoginDestination({pathname:'/my-bids',search:'?view=finished',hash:'#results'})).toBe('/my-bids?view=finished#results');
 });
 it.each(['https://evil.example','//evil.example','/admin','/api/auth/sign-out','/\\evil.example','/profile\u0000'])('cannot hand off to %s',async next=>{
  expect(telegramBrowserLoginDestination({pathname:'/',search:'?next='+encodeURIComponent(next),hash:''})).toBe('/');
  const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({url:'https://oauth.telegram.org/auth?state=fixture',redirect:true}));
  await requestTelegramBrowserLogin(next,'en',new AbortController().signal,transport);
  expect(JSON.parse(transport.mock.calls[0][1]!.body as string).callbackURL).toBe('/');
 });
 it('starts the existing Better Auth provider command once with same-origin cookies and safe callbacks',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({url:'https://oauth.telegram.org/auth?state=fixture&code_challenge=public-fixture',redirect:true}));
  expect(await requestTelegramBrowserLogin('/payments?type=topups','am',new AbortController().signal,transport)).toBe('https://oauth.telegram.org/auth?state=fixture&code_challenge=public-fixture');
  expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0][0]).toBe('/api/auth/sign-in/social');
  expect(transport.mock.calls[0][1]).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'}});
  expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({provider:'telegram-oidc',callbackURL:'/payments?type=topups',errorCallbackURL:'/?login=1&next=%2Fpayments%3Ftype%3Dtopups&lang=am',disableRedirect:true});
 });
 it.each([null,{}, {url:'https://evil.example/auth',redirect:true},{url:'https://oauth.telegram.org.evil.example/auth',redirect:true},{url:'https://oauth.telegram.org/token',redirect:true},{url:'http://oauth.telegram.org/auth',redirect:true},{url:'https://user:password@oauth.telegram.org/auth',redirect:true},{url:'https://oauth.telegram.org/auth#token',redirect:true},{url:'https://oauth.telegram.org/auth',redirect:false}])('rejects an unexpected start response %j',async result=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));await expect(requestTelegramBrowserLogin('/','en',new AbortController().signal,transport)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
 });
 it('bounds a stalled start and never automatically retries the authorization command',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
  await expect(requestTelegramBrowserLogin('/','en',new AbortController().signal,transport,15)).rejects.toMatchObject({name:'AbortError'});expect(transport).toHaveBeenCalledTimes(1);
 });
 it('includes a stalled response body in the start deadline',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue({ok:true,json:()=>new Promise(()=>{})} as unknown as Response);
  await expect(requestTelegramBrowserLogin('/','en',new AbortController().signal,transport,15)).rejects.toMatchObject({name:'AbortError'});expect(transport).toHaveBeenCalledTimes(1);
 });
 it('cancels an outstanding start when its sheet closes',async()=>{
  const controller=new AbortController(),transport=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
  const request=requestTelegramBrowserLogin('/','en',controller.signal,transport);controller.abort();await expect(request).rejects.toMatchObject({name:'AbortError'});expect(transport).toHaveBeenCalledTimes(1);
 });
 it('shows only an allowlisted feedback category, never a reflected provider error',()=>{
  for(const value of ['cancelled','expired','unavailable','invalid','contact_required','conflict'])expect(telegramBrowserLoginError(value)).toBe(value);
  for(const value of [null,'','access_token=secret','<script>throw Error()</script>','invalid&next=//evil.example'])expect(telegramBrowserLoginError(value)).toBeNull();
 });
});
