/** Format validation only; the selected wallet still verifies registration and
 * authorization. Never infer a registered account or successful payment here. */
export function normalizePaymentPhone(raw:string):string|null{
 const digits=raw.trim().replace(/[\s()-]/g,'').replace(/^\+/, '');
 if(/^0[79]\d{8}$/.test(digits))return '251'+digits.slice(1);
 if(/^[79]\d{8}$/.test(digits))return '251'+digits;
 return /^251[79]\d{8}$/.test(digits)?digits:null;
}
export type PaymentPhoneProblem='invalid'|'mpesa_prefix'|'telebirr_prefix';
/** These wallet-prefix rules match Chapa's published wallet descriptors.
 * CBE Birr/eBirr allow either Ethiopian mobile prefix. */
export function paymentPhoneProblem(raw:string,method:string):PaymentPhoneProblem|null{
 const phone=normalizePaymentPhone(raw);
 if(!phone)return 'invalid';
 if(method==='mpesa'&&!phone.startsWith('2517'))return 'mpesa_prefix';
 if(method==='telebirr'&&!phone.startsWith('2519'))return 'telebirr_prefix';
 return null;
}
export function paymentPhoneProblemMessage(problem:PaymentPhoneProblem,am=false):string{
 const messages:Record<PaymentPhoneProblem,readonly[string,string]>={
  invalid:['Enter a complete Ethiopian mobile number starting with 07, 09, +2517 or +2519.','በ07፣ 09፣ +2517 ወይም +2519 የሚጀምር ሙሉ የኢትዮጵያ ሞባይል ቁጥር ያስገቡ።'],
  mpesa_prefix:['For M-Pesa, enter a number starting with 07 or +2517.','ለM-Pesa በ07 ወይም +2517 የሚጀምር ቁጥር ያስገቡ።'],
  telebirr_prefix:['For telebirr, enter a number starting with 09 or +2519.','ለtelebirr በ09 ወይም +2519 የሚጀምር ቁጥር ያስገቡ።'],
 };
 return messages[problem][am?1:0];
}
