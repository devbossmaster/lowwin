/** Exact number parsing shared by current and historical bid adapters. */
export function parseBidCents(value:string):bigint {
  if(!/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value))throw new Error('Enter an ETB amount with at most two decimal places.');
  const [whole,fraction='']=value.split('.');
  const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(cents<=0n||cents>BigInt('9223372036854775807'))throw new Error('Bid is outside the supported ETB range.');
  return cents;
}
