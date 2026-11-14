/** This marker contains no identity, consent, or financial information. */
export const INTRODUCTION_DISMISSAL_KEY='lowwin:channel-invite:v1';
export function introductionDismissed(storage:Pick<Storage,'getItem'>):boolean{
 try{return storage.getItem(INTRODUCTION_DISMISSAL_KEY)==='dismissed'}catch{return false}
}
export function dismissIntroduction(storage:Pick<Storage,'setItem'>):void{
 try{storage.setItem(INTRODUCTION_DISMISSAL_KEY,'dismissed')}catch{/* Browsing remains usable when storage is unavailable. */}
}
