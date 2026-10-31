/** Chapa v2 request errors are separate from verified payment outcomes.
 * Only HTTP status and error.code control handling; never message/details. */
export type ChapaApiErrorCategory='request'|'reference'|'state'|'configuration'|'temporary';

export function classifyChapaApiError(httpStatus:number|null|undefined,code:string|null|undefined):ChapaApiErrorCategory{
 if(httpStatus===401||httpStatus===403)return 'configuration';
 if(httpStatus===409||[400,422].includes(httpStatus??0)&&code==='INVALID_STATE')return 'state';
 if(httpStatus===404||httpStatus===400&&code==='NOT_FOUND')return 'reference';
 if(httpStatus===400||httpStatus===422)return 'request';
 return 'temporary';
}
