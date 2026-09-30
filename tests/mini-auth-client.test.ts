import {afterEach,describe,expect,it,vi} from 'vitest';
import {miniAuthError,signInTelegram,TelegramLaunchError} from '../src/lib/mini-auth-client';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers()});
describe('Telegram startup request',()=>{
  it('finishes one sign-in request even when the response takes more than twelve seconds',async()=>{
    vi.useFakeTimers();
    vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{
      const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Timed out','TimeoutError')),ms);return controller.signal;
    });
    const account={status:'authenticated',me:{user:{id:'player',name:'Player'},wallet:{available:'0',held:'0'}}};
    const request=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((resolve,reject)=>{
      options.signal!.addEventListener('abort',()=>reject(options.signal!.reason));
      setTimeout(()=>resolve(Response.json(account)),13000);
    }));
    vi.stubGlobal('fetch',request);
    const result=signInTelegram('signed-launch');
    await vi.advanceTimersByTimeAsync(13000);
    expect(await result).toEqual(account);expect(request).toHaveBeenCalledTimes(1);
  });
  it('returns contact-required without requesting the wallet or contact endpoint',async()=>{
    const request=vi.fn(async()=>Response.json({status:'contact-required',me:null}));vi.stubGlobal('fetch',request);
    expect(await signInTelegram('signed-launch')).toEqual({status:'contact-required',me:null});expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([401,403])('marks %s as a rejected launch without an automatic sign-in retry',async status=>{
    const request=vi.fn(async()=>Response.json({}, {status}));vi.stubGlobal('fetch',request);
    await expect(signInTelegram('signed-launch')).rejects.toBeInstanceOf(TelegramLaunchError);expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    [429,'Too many attempts. Try again shortly.'],
    [503,'Connection interrupted. Tap Retry.'],
  ])('keeps %s retryable without an automatic sign-in retry',async(status,message)=>{
    const request=vi.fn(async()=>Response.json({}, {status:Number(status)}));vi.stubGlobal('fetch',request);
    const error=await signInTelegram('signed-launch').catch(error=>error);
    expect(error).toBeInstanceOf(Error);expect(error).not.toBeInstanceOf(TelegramLaunchError);
    expect(miniAuthError(error)).toBe(message);expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    new DOMException('raw timeout','TimeoutError'),
    new TypeError('Failed to fetch'),
  ])('keeps a transport failure retryable without an automatic retry',async failure=>{
    const request=vi.fn(async()=>{throw failure});vi.stubGlobal('fetch',request);
    await expect(signInTelegram('signed-launch')).rejects.toBe(failure);
    expect(failure).not.toBeInstanceOf(TelegramLaunchError);expect(request).toHaveBeenCalledTimes(1);
  });
  it('provides short retry instructions for browser timeouts and network failures',()=>{
    expect(miniAuthError(new DOMException('raw timeout','TimeoutError'))).toBe('Connection took too long. Tap Retry.');
    expect(miniAuthError(new TypeError('Failed to fetch'))).toBe('Connection interrupted. Tap Retry.');
  });
});
