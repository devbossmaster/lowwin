import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({status:'guest',me:null,botUrl:'https://t.me/fixture_bot',retry:vi.fn(),closeRegistration:vi.fn()}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>state}));
vi.mock('../src/components/account-sheet',()=>({AccountSheet:({children}:{children:ReactNode})=>children}));
vi.mock('../src/components/telegram-bot-link',()=>({TelegramBotLink:({children,...props}:{children:ReactNode;href:string})=>createElement('a',props,children)}));

import BrowserTelegramLogin from '../src/components/browser-telegram-login';
import {MiniLocaleProvider} from '../src/components/mini-locale';

const render=(enabled:boolean)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(BrowserTelegramLogin,{configuration:{enabled,configured:enabled}})}));

it.each([true,false])('offers an existing session retry independently of website sign-in availability (%s)',enabled=>{
 state.status='error';
 const unavailable=render(enabled);
 expect(unavailable).toContain('Retry connection');
 expect(unavailable).not.toContain('>Continue with Telegram<');
 state.status='loading';
 expect(render(enabled)).toContain('Restoring your account');
 state.status='guest';
 const guest=render(enabled);
 expect(guest).not.toContain('Retry connection');
 expect(guest).toContain(enabled?'>Continue with Telegram<':'Open LowWin in Telegram');
});
