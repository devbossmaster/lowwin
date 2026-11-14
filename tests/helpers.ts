import { createHmac } from 'node:crypto';
export const TEST_TOKEN = '123456789:fixture_token_not_a_real_bot_secret';
export const LOCAL_ACCESS_KEY = 'fixture-local-operator-key-never-use-outside-tests';
// Existing browser scenarios assert English copy; new visitors default to Amharic.
// Most existing scenarios represent a returning visitor. Introduction-specific
// checks explicitly remove this non-sensitive marker before their first visit.
export const ENGLISH_UI_STATE = {cookies:[{name:'lowwin-language',value:'en',domain:'localhost',path:'/',expires:-1,httpOnly:false,secure:false,sameSite:'Lax' as const}],origins:[3107,3108,3137,3156,3157].flatMap(port=>['http','https'].map(protocol=>({origin:`${protocol}://localhost:${port}`,localStorage:[{name:'lowwin:channel-invite:v1',value:'dismissed'}]})))};
export function signedLaunch(fields: Record<string,string> = {}, token = TEST_TOKEN) {
  const params = new URLSearchParams({ auth_date: Math.floor(Date.now()/1000).toString(), user: JSON.stringify({ id: 778899, first_name: 'Test player' }), ...fields });
  const check = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const key = createHmac('sha256','WebAppData').update(token).digest();
  params.set('hash',createHmac('sha256',key).update(check).digest('hex'));
  return params.toString();
}
