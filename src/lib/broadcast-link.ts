const paths=new Set(['/','/auctions/all','/my-bids','/winners','/profile']);
/** Broadcast buttons open only known Mini App destinations on our own origin. */
export function broadcastMiniAppPath(value:string){
 if(paths.has(value)||/^\/auctions\/[1-9]\d{0,8}$/.test(value))return value;
 throw new Error('Choose a supported Mini App page.');
}
export function broadcastButtonLabel(value:string|undefined){
 const label=(value??'Open Lowwin').trim();
 if(!label||label.length>40||/[\u0000-\u001f\u007f]/.test(label))throw new Error('Button label must be 1–40 characters.');
 return label;
}
