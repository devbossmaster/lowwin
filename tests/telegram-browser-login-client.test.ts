import {describe,expect,it,vi} from 'vitest';
import {loadTelegramBrowserLoginConfiguration,telegramBrowserLoginDestination,telegramBrowserLoginError,telegramBrowserLoginStart,telegramEnvironment} from '../src/lib/telegram-browser-login-client';

describe('browser Telegram login presentation and handoff',()=>{
 it('loads only public readiness booleans and ignores extra fields',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({enabled:true,configured:true,unexpected:'discard'}));
  expect(await loadTelegramBrowserLoginConfiguration(new AbortController().signal,transport)).toEqual({enabled:true,configured:true});
  expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0][0]).toBe('/api/auth/telegram/browser/config');
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
 it.each(['https://evil.example','//evil.example','/admin','/api/auth/sign-out','/\\evil.example','/profile\u0000'])('cannot hand off to %s',next=>{
  expect(telegramBrowserLoginDestination({pathname:'/',search:'?next='+encodeURIComponent(next),hash:''})).toBe('/');
  expect(new URL(telegramBrowserLoginStart(next,'en'),'https://lowwin.test').searchParams.get('next')).toBe('/');
 });
 it('starts only the same-origin server flow, with encoded locale and safe return path',()=>{
  const start=new URL(telegramBrowserLoginStart('/payments?type=topups','am'),'https://lowwin.test');expect(start.origin).toBe('https://lowwin.test');expect(start.pathname).toBe('/api/auth/telegram/browser/start');expect(start.searchParams.get('next')).toBe('/payments?type=topups');expect(start.searchParams.get('lang')).toBe('am');expect([...start.searchParams.keys()]).toEqual(['next','lang']);
 });
 it('shows only an allowlisted feedback category, never a reflected provider error',()=>{
  for(const value of ['cancelled','expired','unavailable','invalid','contact_required','conflict'])expect(telegramBrowserLoginError(value)).toBe(value);
  for(const value of [null,'','access_token=secret','<script>throw Error()</script>','invalid&next=//evil.example'])expect(telegramBrowserLoginError(value)).toBeNull();
 });
});
