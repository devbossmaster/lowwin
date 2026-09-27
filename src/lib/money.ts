/** Ledger integers are whole birr. The audited legacy conversion is 1:1. */
export function formatEtb(value:string|bigint):string{
  const amount=BigInt(value),absolute=amount<0n?-amount:amount;
  return `${amount<0n?'-':''}ETB ${new Intl.NumberFormat('en-US').format(absolute)}.00`;
}

/** Render immutable pre-conversion public terms without changing stored terms. */
export function legacyTermsInEtb(value:string):string{
  return value.replace(/\b(\d+)\s+points?\b/gi,(_match,amount:string)=>formatEtb(amount))
    .replace(/\bpoint amounts?\b/gi,'ETB amounts')
    .replace(/\bpoints?\b/gi,'ETB');
}
