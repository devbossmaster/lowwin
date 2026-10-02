/** A compact display reference. The complete bid ID remains the database key. */
export function bidTicket(id:string){
  return `BID_${id.replaceAll('-','').slice(0,12).toUpperCase()}`;
}
