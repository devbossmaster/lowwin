/** A batched activity revision can refresh an open detail without polling its
 * full product payload. Remember each attempted revision, including failures;
 * normal focus/manual refresh remains available without a request loop. */
export function auctionPresentationRefreshVersion(current:number|undefined,observed:number|undefined,lastRequested:number){
 return typeof observed==='number'&&Number.isSafeInteger(observed)&&observed>Math.max(current??0,lastRequested)?observed:null;
}
