/** Definitive customer failures, distinct from missing provider evidence. */
export const customerDepositFailures=new Set(['NOT_FOUND','INVALID_RECEIPT','REFERENCE_MISMATCH','RECEIVER_MISMATCH','AMOUNT_MISMATCH','DATE_MISMATCH','DUPLICATE_CONFLICT']);
export const depositFailureMessages:Record<string,string>={
 NOT_FOUND:'No transaction was found for this ID. Check the ID and selected receiving account.',
 INVALID_RECEIPT:'This transaction ID is invalid. Check your payment receipt.',
 REFERENCE_MISMATCH:'The receipt does not match this transaction ID. Check your receipt.',
 RECEIVER_MISMATCH:'This transfer was not sent to our receiving account. Check the selected account.',
 AMOUNT_MISMATCH:'This transfer amount is outside the allowed deposit amount. Check the amount shown.',
 DATE_MISMATCH:'This transfer date is outside the accepted deposit period. Check your receipt.',
 DUPLICATE_CONFLICT:'This transaction ID has already been used. No additional credit was added.',
};
