import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({environment:'mini',status:'contact-required',needsReopen:false,botUrl:'https://t.me/fixture_bot'}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({...state,openRegistration:vi.fn(),retry:vi.fn()})}));
vi.mock('../src/components/telegram-bot-link',()=>({TelegramBotLink:({children,...props}:{children:React.ReactNode;href:string})=>createElement('a',props,children)}));
import {MiniAccountAction} from '../src/components/mini-account-action';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=(language:'en'|'am'='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(MiniAccountAction)}));
beforeEach(()=>{Object.assign(state,{environment:'mini',status:'contact-required',needsReopen:false})});
describe('native Mini account presentation',()=>{
 it.each(['en','am'] as const)('offers contact recovery without website login in %s',language=>{const html=render(language);expect(html).toContain(language==='en'?'Share contact':'ስልክ ቁጥር ያጋሩ');expect(html).not.toMatch(/Log in|Continue with Telegram|oauth.telegram.org/)});
 it('waits for signed SDK data and permits retry after a transport failure',()=>{state.status='loading';expect(render()).toContain('Connecting');state.status='error';expect(render()).toContain('Try again')});
 it('uses an explicit bot reopen after a missing or invalid launch',()=>{state.status='error';state.needsReopen=true;const html=render();expect(html).toContain('Reopen in Telegram');expect(html).toContain('https://t.me/fixture_bot');expect(html).not.toContain('<button')});
 it('never presents native contact recovery on the website or for a registered account',()=>{state.environment='browser';expect(render()).toBe('');state.environment='mini';state.status='authenticated';expect(render()).toBe('')});
});
