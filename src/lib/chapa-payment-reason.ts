/** Only exact, recognized provider reasons become customer-facing codes.
 * Never relay arbitrary bank messages, payer details, HTML or internal errors. */
export type ChapaPaymentReasonCode='INSUFFICIENT_FUNDS'|'INVALID_PIN'|'INVALID_OTP'|'PAYMENT_ACCOUNT_NOT_FOUND'|'AUTHORIZATION_REQUIRED'|'PAYMENT_BLOCKED'|'PAYMENT_CANCELLED'|'PAYMENT_EXPIRED';
const aliases:Record<string,ChapaPaymentReasonCode>={
 INSUFFICIENT_FUNDS:'INSUFFICIENT_FUNDS',INSUFFICIENT_BALANCE:'INSUFFICIENT_FUNDS','INSUFFICIENT BALANCE':'INSUFFICIENT_FUNDS','INSUFFICIENT BALANCE.':'INSUFFICIENT_FUNDS','INSUFFICIENT FUNDS':'INSUFFICIENT_FUNDS',
 INVALID_PIN:'INVALID_PIN',INCORRECT_PIN:'INVALID_PIN',WRONG_PIN:'INVALID_PIN','INCORRECT PIN':'INVALID_PIN','INVALID PIN':'INVALID_PIN',
 INVALID_OTP:'INVALID_OTP',INCORRECT_OTP:'INVALID_OTP','THE OTP ENTERED IS INCORRECT':'INVALID_OTP','THE OTP ENTERED IS INCORRECT.':'INVALID_OTP',
 PAYMENT_ACCOUNT_NOT_FOUND:'PAYMENT_ACCOUNT_NOT_FOUND',PHONE_NOT_REGISTERED:'PAYMENT_ACCOUNT_NOT_FOUND',NUMBER_NOT_REGISTERED:'PAYMENT_ACCOUNT_NOT_FOUND',CUSTOMER_NOT_REGISTERED:'PAYMENT_ACCOUNT_NOT_FOUND',ACCOUNT_NOT_FOUND:'PAYMENT_ACCOUNT_NOT_FOUND',INVALID_ACCOUNT_NUMBER:'PAYMENT_ACCOUNT_NOT_FOUND','PHONE NUMBER IS NOT REGISTERED':'PAYMENT_ACCOUNT_NOT_FOUND','INVALID ACCOUNT NUMBER':'PAYMENT_ACCOUNT_NOT_FOUND',
 AUTHORIZATION_REQUIRED:'AUTHORIZATION_REQUIRED',PAYMENT_BLOCKED:'PAYMENT_BLOCKED',TRANSACTION_BLOCKED:'PAYMENT_BLOCKED',
 PAYMENT_CANCELLED:'PAYMENT_CANCELLED',CUSTOMER_CANCELLED:'PAYMENT_CANCELLED',PAYMENT_EXPIRED:'PAYMENT_EXPIRED',SESSION_EXPIRED:'PAYMENT_EXPIRED',
};
export const chapaReasonStatuses=new Set(['FAILED','CANCELLED','INCOMPLETE','BLOCKED','AUTH_NEEDED']);
export function safeChapaPaymentReason(value:unknown):ChapaPaymentReasonCode|null{
 if(typeof value!=='string'||value.length>120)return null;
 const normalized=value.trim().toUpperCase();return Object.hasOwn(aliases,normalized)?aliases[normalized]:null;
}
export function publicChapaPaymentReason(order:{reason:string|null;providerStatus:string|null;verificationState:string}):ChapaPaymentReasonCode|null{
 return order.verificationState==='VERIFIED'&&chapaReasonStatuses.has(order.providerStatus??'')&&order.reason?.startsWith('CHAPA_')?safeChapaPaymentReason(order.reason.slice(6)):null;
}
const messages:Record<ChapaPaymentReasonCode,[string,string]>={
 PAYMENT_ACCOUNT_NOT_FOUND:['Chapa could not find this account with the selected payment provider. Use a number registered with that provider.','Chapa በመረጡት የክፍያ አቅራቢ ይህን መለያ ማግኘት አልቻለም። በዚያ አቅራቢ የተመዘገበ ቁጥር ይጠቀሙ።'],
 INSUFFICIENT_FUNDS:['Chapa reports insufficient funds in the payment account.','Chapa በክፍያ መለያው ውስጥ ያለው ገንዘብ እንደማይበቃ አሳውቋል።'],
 INVALID_PIN:['Chapa reports an incorrect payment PIN. Use only your payment provider’s secure prompt.','Chapa የክፍያ PIN ትክክል እንዳልሆነ አሳውቋል። የክፍያ አቅራቢዎን ደህንነቱ የተጠበቀ መስኮት ብቻ ይጠቀሙ።'],
 INVALID_OTP:['Chapa reports an incorrect verification code. Use only the provider’s secure payment flow.','Chapa የማረጋገጫ ኮዱ ትክክል እንዳልሆነ አሳውቋል። የአቅራቢውን ደህንነቱ የተጠበቀ የክፍያ ሂደት ብቻ ይጠቀሙ።'],
 AUTHORIZATION_REQUIRED:['Complete the payment authorization on Chapa.','የክፍያ ፈቃዱን በChapa ያጠናቅቁ።'],
 PAYMENT_BLOCKED:['Chapa reports that this payment is blocked.','Chapa ይህ ክፍያ እንደታገደ አሳውቋል።'],
 PAYMENT_CANCELLED:['Chapa confirms that this payment was cancelled.','Chapa ይህ ክፍያ እንደተሰረዘ አረጋግጧል።'],
 PAYMENT_EXPIRED:['Chapa reports that the payment authorization expired.','Chapa የክፍያ ፈቃዱ ጊዜ እንዳለፈ አሳውቋል።'],
};
export function chapaPaymentReasonMessage(order:{status:string;providerStatus?:string|null;verificationState?:string;providerReasonCode?:string|null},am=false):string|null{
 if(order.verificationState!=='VERIFIED'||order.status!==order.providerStatus||!chapaReasonStatuses.has(order.providerStatus??''))return null;
 const code=safeChapaPaymentReason(order.providerReasonCode);return code?messages[code][am?1:0]:null;
}
