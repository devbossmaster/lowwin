/** Public/API amounts remain ETB strings, including legacy whole-birr records. */
export function etbToCents(value:string):bigint{
  if(!/^-?(0|[1-9]\d{0,18})(?:\.\d{1,2})?$/.test(value))throw new Error('ETB requires at most two decimal places.');
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
  const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  return negative?-cents:cents;
}
export function centsToEtb(cents:bigint):string{
  const absolute=cents<0n?-cents:cents;
  return `${cents<0n?'-':''}${absolute/100n}.${(absolute%100n).toString().padStart(2,'0')}`;
}
export function formatEtb(value:string|bigint|{toString():string}):string{
  const amount=etbToCents(value.toString()),absolute=amount<0n?-amount:amount;
  return `${amount<0n?'-':''}ETB ${new Intl.NumberFormat('en-US').format(absolute/100n)}.${(absolute%100n).toString().padStart(2,'0')}`;
}

/** Render immutable pre-conversion public terms without changing stored terms. */
export function legacyTermsInEtb(value:string):string{
  return value.replace(/\b(\d+)\s+points?\b/gi,(_match,amount:string)=>formatEtb(amount))
    .replace(/\bpoint amounts?\b/gi,'ETB amounts')
    .replace(/\bpoints?\b/gi,'ETB')
    .replace(/\bLowin\b/g,'Lowwin');
}
