import {describe,expect,it,vi} from 'vitest';
import {openBotFromMiniApp} from '../src/lib/telegram-recovery';

const botUrl='https://t.me/Lowwin_bot?start=recover';

describe('Telegram bot recovery navigation',()=>{
  it('opens the configured bot link before explicitly closing the Mini App',()=>{
    const calls:string[]=[];
    const app={
      initData:'signed-launch',
      openTelegramLink:vi.fn((url:string)=>{calls.push(`open:${url}`)}),
      close:vi.fn(()=>{calls.push('close')}),
    };
    expect(openBotFromMiniApp(botUrl,app)).toBe(true);
    expect(app.openTelegramLink).toHaveBeenCalledExactlyOnceWith(botUrl);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([`open:${botUrl}`,'close']);
  });

  it('uses the native SDK when a Telegram platform is present without launch data',()=>{
    const app={platform:'android',openTelegramLink:vi.fn(),close:vi.fn()};
    expect(openBotFromMiniApp('https://t.me/Lowwin_bot',app)).toBe(true);
    expect(app.openTelegramLink).toHaveBeenCalledExactlyOnceWith('https://t.me/Lowwin_bot');
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('leaves ordinary link navigation available when the SDK is missing',()=>{
    expect(openBotFromMiniApp(botUrl)).toBe(false);
  });

  it.each([undefined,'unknown'])('does not call an SDK outside a Mini App with platform %s',platform=>{
    const app={initData:'',platform,openTelegramLink:vi.fn(),close:vi.fn()};
    expect(openBotFromMiniApp(botUrl,app)).toBe(false);
    expect(app.openTelegramLink).not.toHaveBeenCalled();expect(app.close).not.toHaveBeenCalled();
  });

  it('does not close an older SDK that cannot open the bot',()=>{
    const app={initData:'signed-launch',close:vi.fn()};
    expect(openBotFromMiniApp(botUrl,app)).toBe(false);
    expect(app.close).not.toHaveBeenCalled();
  });

  it('leaves ordinary link navigation available if explicit close is unavailable',()=>{
    const app={initData:'signed-launch',openTelegramLink:vi.fn()};
    expect(openBotFromMiniApp(botUrl,app)).toBe(false);
    expect(app.openTelegramLink).not.toHaveBeenCalled();
  });

  it('does not close the Mini App when opening the bot throws',()=>{
    const app={initData:'signed-launch',openTelegramLink:vi.fn(()=>{throw new Error('Open failed')}),close:vi.fn()};
    expect(openBotFromMiniApp(botUrl,app)).toBe(false);
    expect(app.openTelegramLink).toHaveBeenCalledTimes(1);expect(app.close).not.toHaveBeenCalled();
  });

  it('keeps the native link handled if close throws so the anchor does not open the bot twice',()=>{
    const app={initData:'signed-launch',openTelegramLink:vi.fn(),close:vi.fn(()=>{throw new Error('Close failed')})};
    expect(openBotFromMiniApp(botUrl,app)).toBe(true);
    expect(app.openTelegramLink).toHaveBeenCalledExactlyOnceWith(botUrl);expect(app.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    'javascript:alert(1)',
    'http://t.me/Lowwin_bot',
    'https://t.me.evil.example/Lowwin_bot',
    'https://evil.example/Lowwin_bot',
    'https://user:password@t.me/Lowwin_bot',
    'https://t.me/share/url?url=https://example.com',
    'https://t.me/Lowwin_bot?redirect=https://evil.example',
    'not a URL',
  ])('rejects an unsafe bot link before calling the SDK: %s',url=>{
    const app={initData:'signed-launch',openTelegramLink:vi.fn(),close:vi.fn()};
    expect(openBotFromMiniApp(url,app)).toBe(false);
    expect(app.openTelegramLink).not.toHaveBeenCalled();expect(app.close).not.toHaveBeenCalled();
  });
});
