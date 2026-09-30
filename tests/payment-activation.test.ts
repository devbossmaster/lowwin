import {describe,it,expect} from 'vitest';
import {liveFundingConfigured} from '../src/modules/payments/activation';
const live={PAYMENTS_LIVE_ENABLED:'true',VERIFY_ET_SCHEMA_READY:'true',APP_ENV:'production',NODE_ENV:'production',VERIFY_ET_API_KEY:'test-value-never-used-for-a-provider-call',VERIFY_ET_WEBHOOK_SECRET:'whsec_test_value',BETTER_AUTH_URL:'https://lowwin.example',MINI_APP_URL:'https://lowwin.example/telegram'};
describe('explicit production funding activation',()=>{
 it('defaults off and requires the complete production configuration',()=>{expect(liveFundingConfigured({})).toBe(false);expect(liveFundingConfigured(live)).toBe(true);for(const key of Object.keys(live))expect(liveFundingConfigured({...live,[key]:undefined})).toBe(false)});
 it('rejects mixed test credentials, endpoints, DEMO issuance and unsafe origins',()=>{
  for(const [key,value] of Object.entries({VERIFY_ET_TEST_ENDPOINT:'http://localhost:5000/api/verify',PAYMENTS_TEST_ENABLED:'true',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'true',STAGING_DEMO_ENABLED:'true',BETTER_AUTH_URL:'http://lowwin.example',MINI_APP_URL:'bad-url',VERIFY_ET_API_KEY:'REPLACE_ME'}))expect(liveFundingConfigured({...live,[key]:value})).toBe(false);
 });
});
