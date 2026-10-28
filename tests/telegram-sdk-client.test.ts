import {afterEach,describe,expect,it,vi} from 'vitest';
import {observeTelegramSdk,TELEGRAM_SDK_URL} from '../src/lib/telegram-sdk-client';

function fixture(){
 const listeners=new Map<string,Set<EventListener>>();
 const doc={
  addEventListener:vi.fn((type:string,listener:EventListener)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(listener)}),
  removeEventListener:vi.fn((type:string,listener:EventListener)=>listeners.get(type)?.delete(listener)),
 };
 const win:{Telegram?:{WebApp:unknown}}={};
 vi.stubGlobal('document',doc);vi.stubGlobal('window',win);vi.useFakeTimers();
 const emit=(type:string,src=TELEGRAM_SDK_URL)=>{for(const listener of listeners.get(type)??[])listener({target:{tagName:'SCRIPT',src}} as unknown as Event)};
 const ready=vi.fn(),unavailable=vi.fn();
 return {win,doc,emit,ready,unavailable,start:()=>observeTelegramSdk(ready,unavailable,8000)};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks()});

describe('eager Telegram SDK readiness',()=>{
 it('starts immediately when the SDK finished before hydration, even without launch data',()=>{
  const f=fixture();f.win.Telegram={WebApp:{}};const stop=f.start();
  expect(f.ready).toHaveBeenCalledOnce();expect(f.unavailable).not.toHaveBeenCalled();
  expect(f.doc.addEventListener).toHaveBeenCalledTimes(2);stop();
 });
 it('reacts to script load without an artificial startup delay and ignores unrelated scripts',()=>{
  const f=fixture(),stop=f.start();f.emit('load','https://example.com/other.js');expect(f.ready).not.toHaveBeenCalled();
  f.win.Telegram={WebApp:{initData:'signed'}};f.emit('load');expect(f.ready).toHaveBeenCalledOnce();
  f.emit('load');vi.advanceTimersByTime(8000);expect(f.ready).toHaveBeenCalledOnce();expect(f.unavailable).not.toHaveBeenCalled();stop();
 });
 it.each(['error','timeout'])('retains recovery for an SDK arriving after %s',kind=>{
  const f=fixture(),stop=f.start();if(kind==='error')f.emit('error');else vi.advanceTimersByTime(8000);
  expect(f.unavailable).toHaveBeenCalledOnce();f.emit('error');vi.advanceTimersByTime(8000);expect(f.unavailable).toHaveBeenCalledOnce();
  f.win.Telegram={WebApp:{initData:'signed'}};f.emit('load');expect(f.ready).toHaveBeenCalledOnce();stop();
 });
 it('does not silently authenticate a loaded script with no usable SDK',()=>{
  const f=fixture(),stop=f.start();f.emit('load');expect(f.ready).not.toHaveBeenCalled();expect(f.unavailable).toHaveBeenCalledOnce();stop();
 });
 it('cancels pending callbacks and listeners when the provider unmounts',()=>{
  const f=fixture(),stop=f.start();stop();f.win.Telegram={WebApp:{}};f.emit('load');vi.advanceTimersByTime(8000);
  expect(f.ready).not.toHaveBeenCalled();expect(f.unavailable).not.toHaveBeenCalled();expect(f.doc.removeEventListener).toHaveBeenCalledTimes(2);
 });
});
