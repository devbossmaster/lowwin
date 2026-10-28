import {describe,expect,it} from 'vitest';
import {matchesChapaMetadata} from '../src/modules/payments/chapa-metadata';

const checkoutId='d653947b-15c9-4142-93b6-c5231d9cf18b';
const minimal={amountCents:'1000',merchantReference:'LW123456789012345678',idempotencyKey:`lowwin:${checkoutId}`};
describe('verification metadata bound to persisted initialization',()=>{
 it.each([undefined,{}, {provider_note:'optional'}, {lowwin_attempt:checkoutId}, {lowwin_attempt:checkoutId,unrelated:'accepted'}])('accepts optional metadata %j for the minimal request',metadata=>{
  expect(matchesChapaMetadata(minimal,metadata,checkoutId)).toBe(true);
 });
 it.each(['another-checkout','',null,123,undefined])('rejects conflicting or malformed explicit attempt %j',lowwin_attempt=>{
  expect(matchesChapaMetadata(minimal,{lowwin_attempt},checkoutId)).toBe(false);
 });
 it('preserves historical expectations when verification supplies metadata',()=>{
  const historical={...minimal,meta:{lowwin_attempt:checkoutId,order_id:'historical-order'}};
  expect(matchesChapaMetadata(historical,undefined,checkoutId)).toBe(true);
  expect(matchesChapaMetadata(historical,{...historical.meta,note:'provider'},checkoutId)).toBe(true);
  for(const metadata of [{},{note:'unrelated'},{lowwin_attempt:checkoutId},{...historical.meta,order_id:'changed'},{...historical.meta,lowwin_attempt:'another-checkout'}])expect(matchesChapaMetadata(historical,metadata,checkoutId)).toBe(false);
 });
});
