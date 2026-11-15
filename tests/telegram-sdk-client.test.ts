import {afterEach,describe,expect,it,vi} from 'vitest';
import {enableTelegramFullscreen,observeTelegramSdk,TELEGRAM_SDK_URL,type TelegramViewportApp} from '../src/lib/telegram-sdk-client';

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
 it('restores native fullscreen presentation when the real launch SDK arrives after its loading deadline',()=>{
  const f=fixture(),requestFullscreen=vi.fn(),expand=vi.fn();let stopPresentation=()=>{};
  const stop=observeTelegramSdk(()=>{stopPresentation=enableTelegramFullscreen(f.win.Telegram?.WebApp as TelegramViewportApp)},f.unavailable,8000);
  vi.advanceTimersByTime(8000);expect(f.unavailable).toHaveBeenCalledOnce();
  f.win.Telegram={WebApp:{initData:'signed-launch',platform:'android',version:'8.0',requestFullscreen,expand}};f.emit('load');
  expect(expand).toHaveBeenCalledOnce();expect(requestFullscreen).toHaveBeenCalledOnce();stopPresentation();stop();
 });
});

function viewportFixture(patch:Partial<TelegramViewportApp>={}){
 const events=new Map<string,(event?:unknown)=>void>(),visibility=new Set<()=>void>();
 const doc={hidden:false,addEventListener:vi.fn((name:string,listener:()=>void)=>{if(name==='visibilitychange')visibility.add(listener)}),removeEventListener:vi.fn((name:string,listener:()=>void)=>{if(name==='visibilitychange')visibility.delete(listener)})};
 const app={initData:'signed-launch-presentation-only',platform:'android',version:'8.0',isActive:true,isExpanded:false,isFullscreen:false,expand:vi.fn(),requestFullscreen:vi.fn(),isVersionAtLeast:vi.fn(()=>true),onEvent:vi.fn((name:string,listener:(event?:unknown)=>void)=>events.set(name,listener)),offEvent:vi.fn((name:string)=>events.delete(name)),...patch};
 vi.stubGlobal('document',doc);
 return {app,doc,events,emit:(name:string,event?:unknown)=>events.get(name)?.(event),visible:(hidden:boolean)=>{doc.hidden=hidden;for(const listener of visibility)listener()},start:()=>enableTelegramFullscreen(app)};
}

describe('Telegram native fullscreen presentation',()=>{
 it.each([{initData:''},{platform:'unknown'}])('leaves normal browser SDK presentation untouched: %j',patch=>{
  const f=viewportFixture(patch),stop=f.start();expect(f.app.expand).not.toHaveBeenCalled();expect(f.app.requestFullscreen).not.toHaveBeenCalled();expect(f.doc.addEventListener).not.toHaveBeenCalled();stop();
 });
 it('requests native fullscreen immediately for a launch on API8+, independently of account loading',()=>{
  const f=viewportFixture(),stop=f.start();expect(f.app.isVersionAtLeast).toHaveBeenCalledWith('8.0');expect(f.app.expand).toHaveBeenCalledOnce();expect(f.app.requestFullscreen).toHaveBeenCalledOnce();expect(f.app.onEvent).toHaveBeenCalledTimes(4);stop();
 });
 it('expands older clients without invoking a version-incompatible fullscreen method',()=>{
  const f=viewportFixture({version:'7.10',isVersionAtLeast:()=>false}),stop=f.start();expect(f.app.expand).toHaveBeenCalledOnce();expect(f.app.requestFullscreen).not.toHaveBeenCalled();expect(f.app.onEvent).not.toHaveBeenCalled();stop();
 });
 it('uses the documented SDK version when a capability helper is absent',()=>{
  const f=viewportFixture({isVersionAtLeast:undefined,version:'10.1'}),stop=f.start();expect(f.app.requestFullscreen).toHaveBeenCalledOnce();stop();
 });
 it('does not request fullscreen again when Telegram already reports fullscreen',()=>{
  const f=viewportFixture({isExpanded:true,isFullscreen:true}),stop=f.start();expect(f.app.expand).not.toHaveBeenCalled();expect(f.app.requestFullscreen).not.toHaveBeenCalled();stop();
 });
 it('falls back to expanded mode after a native unsupported event and does not loop on resume',()=>{
  const f=viewportFixture(),stop=f.start();f.emit('fullscreenFailed',{error:'UNSUPPORTED'});f.visible(true);f.visible(false);f.emit('activated');expect(f.app.requestFullscreen).toHaveBeenCalledOnce();expect(f.app.expand).toHaveBeenCalled();stop();
 });
 it('absorbs an unsupported native-method exception without blocking the launch',()=>{
  const f=viewportFixture({requestFullscreen:vi.fn(()=>{throw Error('Unsupported native method')})});expect(()=>f.start()()).not.toThrow();expect(f.app.expand).toHaveBeenCalled();
 });
 it('coalesces foreground and activated events into one pending request per resume',()=>{
  const f=viewportFixture(),stop=f.start();f.emit('deactivated');f.visible(true);f.visible(false);f.emit('activated');expect(f.app.requestFullscreen).toHaveBeenCalledTimes(2);f.emit('activated');expect(f.app.requestFullscreen).toHaveBeenCalledTimes(2);stop();
 });
 it('respects a user exit and removes all native/visibility listeners when disposed',()=>{
  const f=viewportFixture(),stop=f.start();f.app.isFullscreen=true;f.emit('fullscreenChanged');f.app.isFullscreen=false;f.emit('fullscreenChanged');f.visible(true);f.visible(false);expect(f.app.requestFullscreen).toHaveBeenCalledOnce();stop();expect(f.app.offEvent).toHaveBeenCalledTimes(4);f.emit('activated');f.visible(false);expect(f.app.requestFullscreen).toHaveBeenCalledOnce();
 });
 it('does not request while inactive but restores presentation when the MiniApp becomes active',()=>{
  const f=viewportFixture({isActive:false}),stop=f.start();expect(f.app.requestFullscreen).not.toHaveBeenCalled();f.app.isActive=true;f.emit('activated');expect(f.app.requestFullscreen).toHaveBeenCalledOnce();stop();
 });
});
