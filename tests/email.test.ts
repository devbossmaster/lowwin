import {afterEach,describe,it,expect,vi} from 'vitest';
import {emailAdapter} from '../src/modules/admin/email';
const config:NodeJS.ProcessEnv={NODE_ENV:'test',EMAIL_TRANSPORT:'resend',RESEND_API_KEY:'re_fixture_key',EMAIL_FROM:'staff@example.test'};
afterEach(()=>vi.unstubAllGlobals());
describe('production staff email transport',()=>{
 it('sends only to the requested recipient with deterministic retry identity',async()=>{
  const send=vi.fn(async()=>new Response(null,{status:200}));vi.stubGlobal('fetch',send);
  const message={to:'owner@example.test',subject:'Invitation',text:'Private one-time link'};
  await emailAdapter(config).send(message);await emailAdapter(config).send(message);
  const [url,request]=send.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://api.resend.com/emails');expect(JSON.parse(request.body as string)).toEqual({...message,to:[message.to],from:config.EMAIL_FROM});
  expect((request.headers as Record<string,string>)['Idempotency-Key']).toHaveLength(64);
  expect((send.mock.calls[1] as unknown as [string,RequestInit])[1].headers).toEqual(request.headers);
 });
 it('fails closed without configuration and never exposes provider errors',async()=>{
  expect(()=>emailAdapter({...config,RESEND_API_KEY:''})).toThrow('configure');
  vi.stubGlobal('fetch',async()=>new Response('secret provider detail',{status:401}));
  await expect(emailAdapter(config).send({to:'owner@example.test',subject:'Reset',text:'secret'})).rejects.toThrow('Email delivery unavailable.');
 });
});
