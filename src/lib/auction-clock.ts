/** Client receipt anchors only: no private data, requests, or browser storage. */
export class AuctionClockAnchors{
 private anchors=new Map<string,number>();
 constructor(private readonly limit=64){}
 private receipt(observedAt:number|undefined,clientNow:number){
  // Query initialData has updatedAt=0 until hydration stores its first receipt.
  // Zero is "not observed", not an epoch timestamp to subtract from now.
  return Number.isFinite(observedAt)&&observedAt!>0?Math.min(observedAt!,clientNow):undefined;
 }
 initial(target:string,serverNow:string,observedAt:number|undefined,clientNow:number){
  const known=this.anchors.get(serverNow),received=this.receipt(observedAt,clientNow);
  const anchor=known===undefined?received:received===undefined?known:Math.min(known,received);
  return this.remaining(target,serverNow,anchor??clientNow,clientNow);
 }
 observe(serverNow:string,observedAt:number|undefined,clientNow:number){
  const prior=this.anchors.get(serverNow),received=this.receipt(observedAt,clientNow)??clientNow;
  const anchor=prior===undefined?received:Math.min(prior,received);
  this.anchors.delete(serverNow);this.anchors.set(serverNow,anchor);
  while(this.anchors.size>this.limit)this.anchors.delete(this.anchors.keys().next().value!);
  return anchor;
 }
 remaining(target:string,serverNow:string,anchor:number,clientNow:number){
  const initial=Date.parse(target)-Date.parse(serverNow);
  return Number.isFinite(initial)?Math.max(0,initial-Math.max(0,clientNow-anchor)):0;
 }
 get size(){return this.anchors.size}
}
