export type MyBidListView='live'|'finished';
export function myBidListView(value:string|null,legacyStatus?:string|null):MyBidListView{return value==='finished'||value==='history'||legacyStatus==='completed'?'finished':'live'}
export function myBidsQueryUrl(view:MyBidListView,page:number,language:string){return `/api/my-bids?view=${view}&page=${page}&language=${language==='am'?'am':'en'}`}
export function myBidOutcomeLabel(outcome:string,am:boolean){
 const copy:Record<string,[string,string]>={LIVE:['Bid accepted','ጨረታው ተቀብሏል'],PENDING:['Finalizing result','ውጤቱ እየተጠናቀቀ ነው'],WON:['Winning bid','አሸናፊ ጨረታ'],LOST:['Not winning','አላሸነፈም'],CANCELLED:['Cancelled','ተሰርዟል'],NO_WINNER:['No winning bid','አሸናፊ ጨረታ የለም']};
 return (copy[outcome]??copy.PENDING)[am?1:0];
}
