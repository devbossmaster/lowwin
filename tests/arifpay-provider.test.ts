import {describe,expect,it} from 'vitest';
import {arifPayAvailability,arifPayCanaryAllowed,createdArifPaySession,parseArifPayEvidence} from '../src/modules/payments/arifpay-provider';
const live={ARIFPAY_ENABLED:'true',ARIFPAY_SCHEMA_READY:'true',ARIFPAY_MERCHANT_REVIEWED:'true',APP_ENV:'production',NODE_ENV:'production',BETTER_AUTH_URL:'https://lowin.example',MINI_APP_URL:'https://lowin.example/telegram',ARIFPAY_API_KEY:'merchant-server-key-with-production-access',ARIFPAY_WEBHOOK_TOKEN:'independent-server-callback-token-at-least-32',ARIFPAY_BASE_URL:'https://gateway.arifpay.net',ARIFPAY_CURRENCY:'ETB'};
describe('ArifPay provider boundary',()=>{
 it('stops new ArifPay charges when Chapa is selected and preserves historical recovery',()=>{
  expect(arifPayAvailability({...live,PAYMENT_GATEWAY:'CHAPA'})).toMatchObject({enabled:false,recoveryEnabled:true});
  expect(arifPayAvailability({...live,PAYMENT_GATEWAY:'ARIFPAY'})).toMatchObject({enabled:true,recoveryEnabled:true});
 });
 it('enforces both configured canary account and auction allowlists',()=>{
  const config={ARIFPAY_CANARY_USER_IDS:'player-one, player-two',ARIFPAY_CANARY_AUCTION_SLUGS:'reviewed-auction'};
  expect(arifPayCanaryAllowed('player-one','reviewed-auction',config)).toBe(true);
  expect(arifPayCanaryAllowed('player-three','reviewed-auction',config)).toBe(false);
  expect(arifPayCanaryAllowed('player-one','unreviewed-auction',config)).toBe(false);
  expect(arifPayCanaryAllowed('player-one',undefined,config)).toBe(true);
  expect(arifPayCanaryAllowed('any-player','any-auction',{})).toBe(true);
 });
 it('fails closed for absent, incomplete or development/live mixed configuration',()=>{
  expect(arifPayAvailability({}).enabled).toBe(false);expect(arifPayAvailability(live).enabled).toBe(true);
  for(const field of ['ARIFPAY_ENABLED','ARIFPAY_SCHEMA_READY','ARIFPAY_MERCHANT_REVIEWED','ARIFPAY_API_KEY','ARIFPAY_WEBHOOK_TOKEN','ARIFPAY_CURRENCY'])expect(arifPayAvailability({...live,[field]:''}).enabled).toBe(false);
  for(const extra of [{DEV_POINTS_ENABLED:'true'},{DEV_IDENTITY_ENABLED:'true'},{STAGING_DEMO_ENABLED:'true'},{APP_ENV:'staging'},{ARIFPAY_BASE_URL:'https://untrusted.example'},{ARIFPAY_API_KEY:'arif-sandbox-portal-key'}])expect(arifPayAvailability({...live,...extra}).enabled).toBe(false);
 });
 it('can stop new charges while keeping verified recovery of existing orders available',()=>{
  const paused=arifPayAvailability({...live,ARIFPAY_ENABLED:'false',ARIFPAY_RECOVERY_ENABLED:'true'});
  expect(paused.enabled).toBe(false);expect(paused.recoveryEnabled).toBe(true);
  expect(arifPayAvailability({...live,ARIFPAY_ENABLED:'false',ARIFPAY_RECOVERY_ENABLED:'false'}).recoveryEnabled).toBe(false);
  expect(arifPayAvailability({...live,ARIFPAY_SCHEMA_READY:'false',ARIFPAY_RECOVERY_ENABLED:'true'}).recoveryEnabled).toBe(false);
 });
 it('treats direct USSD acceptance as a session identifier only',()=>{
  expect(createdArifPaySession({error:false,msg:'USSD sent',data:{sessionId:'session-1',transaction:{transactionStatus:'SUCCESS'}}})).toBe('session-1');
  expect(parseArifPayEvidence({error:false,data:{sessionId:'session-1',transaction:{transactionStatus:'SUCCESS'}}})).toBeNull();
  expect(createdArifPaySession({error:true,data:{sessionId:'session-1'}})).toBeNull();
 });
 it('parses the current official merchant nonce lookup and rejects contradictory or incomplete proof',()=>{
  const raw={error:false,msg:null,data:{uuid:'session-1',nonce:'private-nonce',phone:'251911111111',totalAmount:30,transaction:{transactionId:'provider-reference',transactionStatus:'SUCCESS'}}};
  expect(parseArifPayEvidence(raw)).toMatchObject({sessionId:'session-1',nonce:'private-nonce',amount:'30',status:'SUCCESS',transactionId:'provider-reference'});
  for(const data of [{...raw.data,sessionId:'other-session'},{...raw.data,transactionStatus:'FAILED'},{...raw.data,nonce:undefined},{...raw.data,totalAmount:'30.001'},{...raw.data,transaction:{transactionStatus:'UNKNOWN'}}])expect(parseArifPayEvidence({...raw,data})).toBeNull();
 });
});
