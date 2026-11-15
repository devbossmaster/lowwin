import {describe,expect,it} from 'vitest';
import {measureTelegramAuth,timedTelegramAuthResponse} from '../src/modules/auth/telegram-timing';

describe('private Telegram authentication timing',()=>{
 it('adds durations to the existing callback without changing cookies or redirect',async()=>{
  const response=await timedTelegramAuthResponse(async()=>{
   await measureTelegramAuth('oidc_token',async()=>{});await measureTelegramAuth('oidc_profile',async()=>{});
   const headers=new Headers({Location:'https://lowwin.test/my-bids','Cache-Control':'private, no-store'});headers.append('Set-Cookie','test-only-state=opaque-state; HttpOnly; SameSite=Lax');headers.append('Set-Cookie','test-only-session=opaque-session; HttpOnly; SameSite=Lax');return new Response(null,{status:303,headers});
  });
  expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('https://lowwin.test/my-bids');expect(response.headers.getSetCookie()).toEqual(['test-only-state=opaque-state; HttpOnly; SameSite=Lax','test-only-session=opaque-session; HttpOnly; SameSite=Lax']);
  expect(response.headers.get('server-timing')).toMatch(/^oidc_token;dur=\d+\.\d, oidc_profile;dur=\d+\.\d, oidc_total;dur=\d+\.\d$/);
 });
 it('keeps concurrent requests isolated and emits no identities or credential data',async()=>{
  const [first,second]=await Promise.all([
   timedTelegramAuthResponse(async()=>{await measureTelegramAuth('oidc_identity',async()=>{});return Response.json({ok:true})}),
   timedTelegramAuthResponse(async()=>{await measureTelegramAuth('oidc_session',async()=>{});return Response.json({ok:true})}),
  ]);
  expect(first.headers.get('server-timing')).toContain('oidc_identity;dur=');expect(first.headers.get('server-timing')).not.toContain('oidc_session');expect(second.headers.get('server-timing')).toContain('oidc_session;dur=');expect(second.headers.get('server-timing')).not.toContain('oidc_identity');
 });
});
