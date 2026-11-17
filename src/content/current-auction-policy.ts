/** Old managed copy must not advertise retired settlement/refund rules. */
export function retiredAuctionPolicy(value:unknown):boolean{
 const text=typeof value==='string'?value:JSON.stringify(value??'');
 return /(?:first|earliest)[- ]accepted (?:lowest|bid at)|first[- ]accepted fallback|non[- ]refundable|leave a gap after three|(?:four|4) (?:adjacent|consecutive)|ተመላሽ አይሆንም|ክፍያዎች አይመለሱም|ከሦስት ተከታታይ|ከሚከታተሉ ሦስት|አራት ቁጥሮችንም አያቅርቡ/i.test(text);
}
