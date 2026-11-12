import {normalizeBidDraft,validateBidDraft,type BidDraftError,type BidDraftRules} from './bid-batch-client';
import {centsToEtb,etbToCents} from './money';

export type BidRangeError=BidDraftError|'step'|'alignment';
export type BidRangePreview={complete:boolean;count:number;step:string|null;additions:string[];numbers:string[];error:BidRangeError|null};

/** Prefer whole-number ranges; respect an auction's exact increment grid. */
export function defaultBidRangeStep(auctionStep:string):string{
 try{const step=etbToCents(auctionStep);if(step>0n)return centsToEtb(step>=100n?step:((100n+step-1n)/step)*step)}catch{}
 return '1.00';
}

/** Bounded display-only generation. The normal full-draft validator remains
 * authoritative for duplicate, consecutive, bounds and remaining-entry rules. */
export function previewBidRange(from:string,to:string,step:string,selected:readonly string[],rules:BidDraftRules):BidRangePreview{
 const result:BidRangePreview={complete:false,count:0,step:null,additions:[],numbers:[],error:null};
 if(!from||!to)return result;
 result.complete=true;
 const normalizedFrom=normalizeBidDraft(from),normalizedTo=normalizeBidDraft(to),normalizedStep=normalizeBidDraft(step);
 if(!normalizedFrom||!normalizedTo)return {...result,error:'precision'};
 if(!normalizedStep)return {...result,error:'step'};
 const start=etbToCents(normalizedFrom),end=etbToCents(normalizedTo),increment=etbToCents(normalizedStep),auctionStep=etbToCents(rules.stepPoints);
 result.step=normalizedStep;
 if(increment<=0n||auctionStep<=0n||increment%auctionStep!==0n)return {...result,error:'step'};
 if(start>end)return {...result,error:'range'};
 if((end-start)%increment!==0n)return {...result,error:'alignment'};
 const count=(end-start)/increment+1n,remaining=Math.max(0,rules.remainingSubmissions-selected.length);
 if(count>100n||count>BigInt(remaining))return {...result,error:'limit'};
 result.count=Number(count);
 for(let amount=start;amount<=end;amount+=increment)result.additions.push(centsToEtb(amount));
 const checked=validateBidDraft([...selected,...result.additions],rules);
 return {...result,numbers:checked.numbers,error:checked.error};
}
