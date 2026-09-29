/** Exact decimal ETB parsing for the future cent-denominated auction rule. */
export function parseBidCents(value:string):bigint {
  if(!/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value))throw new Error('Enter an ETB amount with at most two decimal places.');
  const [whole,fraction='']=value.split('.');
  const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(cents<=0n||cents>BigInt('9223372036854775807'))throw new Error('Bid is outside the supported ETB range.');
  return cents;
}

/** Reject any four adjacent cent amounts, regardless of submission order. */
export function createsFourConsecutiveAmounts(existing:readonly bigint[],candidate:bigint):boolean {
  const amounts=new Set(existing);
  if(amounts.has(candidate))return false; // Duplicate bids have their own error.
  amounts.add(candidate);
  for(let first=candidate-3n;first<=candidate;first++){
    if(first>0n&&[0n,1n,2n,3n].every(offset=>amounts.has(first+offset)))return true;
  }
  return false;
}
