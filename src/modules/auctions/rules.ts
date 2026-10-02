export const RULE_V1='lowest-unique-v1';
export const RULE_V2='lowest-unique-v2';
export const RULE_V3='lowest-unique-v3';
export const RULE_V4='lowest-unique-v4';
export const isSubmissionFeeOnly=(ruleVersion?:string)=>ruleVersion===RULE_V4;
export const usesDecimalBids=(ruleVersion:string)=>[RULE_V3,RULE_V4].includes(ruleVersion);
export const V4_NUMBER_TERMS='Choose a number from 1.00 in steps of 0.01, with no configured maximum. The number is not money and is never reserved or charged, including when you win. Pay only the displayed submission fee for each accepted bid. Up to 100 different numbers per person; leave a gap after three consecutive numbers separated by 0.01.';
export const V4_CANCELLATION_TERMS='At least two eligible participants must have accepted bids at the deadline; otherwise the auction is cancelled. Submission fees are non-refundable for all outcomes, including cancellation by LowWin or insufficient participation. Rejected submissions are not charged.';
export const V3_AMOUNT_TERMS='Minimum bid ETB 1.00. Amounts accept at most two decimal places. A participant cannot hold four adjacent cent amounts in the same auction, regardless of submission order: after 1.01, 1.02 and 1.03, skip 1.04; 1.05 is allowed. The 100 distinct-bid limit applies.';
export const V2_MIN_PARTICIPANTS=2;
export const V2_FALLBACK_TERMS='At least two distinct eligible participants must have accepted bids. The lowest unique accepted amount wins. Only if no amount is unique, the lowest submitted amount wins for the participant whose bid at that amount PostgreSQL accepted first, using immutable per-auction acceptance order.';
export const V2_CANCELLATION_TERMS='If fewer than two distinct eligible participants have accepted bids at the published deadline, including no bids, the auction is automatically cancelled. Every charged entry fee is refunded and every hold is released. Any other cancellation also refunds all entry fees and releases all holds.';
export const V3_NO_FEE_CANCELLATION_TERMS='If fewer than two distinct eligible participants have accepted bids at the published deadline, including no bids, the auction is automatically cancelled and every hold is released. Any other cancellation also releases all holds. No additional bid fee is charged.';
export function resultExplanation(outcome:string,decision?:string|null,ruleVersion?:string){
 if(isSubmissionFeeOnly(ruleVersion))return outcome==='CANCELLED'?'Auction cancelled. Accepted submission fees are non-refundable.':decision==='FIRST_ACCEPTED_LOWEST'?'No number was unique. The earliest accepted bid at the lowest number won. No charge for the winning number.':'The lowest unique number won. Only submission fees were charged.';
 if(decision==='MINIMUM_PARTICIPANTS')return 'Fewer than two distinct eligible participants had accepted bids at the deadline. The auction was automatically cancelled; all entry fees were refunded and all holds released.';
 if(decision==='FIRST_ACCEPTED_LOWEST')return 'No accepted amount was unique. The lowest submitted amount won for the participant whose bid at that amount PostgreSQL accepted first. Unused holds were released; disclosed entry fees were retained.';
 if(outcome==='WINNER')return 'The winning ETB amount was the smallest amount accepted exactly once. All other holds were released.';
 if(outcome==='NO_WINNER')return 'No accepted amount was unique. All holds were released; disclosed entry fees were retained.';
 return 'The auction was cancelled before settlement. All holds and charged entry fees were returned.';
}
