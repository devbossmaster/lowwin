// Keep a retry tied to the same receipt bytes and frozen deposit fields.
// Nothing is stored outside the current mounted wallet screen.
export async function receiptImageKey(keys:Map<string,string>,intentId:string,image:Blob){
 const digest=await crypto.subtle.digest('SHA-256',await image.arrayBuffer());
 const fingerprint=`${intentId}:${image.type}:${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
 let key=keys.get(fingerprint);
 if(!key){key=crypto.randomUUID();keys.set(fingerprint,key)}
 return key;
}
