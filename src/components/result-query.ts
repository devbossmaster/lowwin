import {miniNavigationState} from './mini-navigation-state';
import {prefetchPrivateQuery} from './private-query-cache';

export function resultQueryUrl(code:string){
 return `/api/results/${encodeURIComponent(code)}`;
}

export function resultNumbersQueryUrl(code:string,{page,sort,jump}:{page:number;sort:'amount'|'picked';jump:boolean}){
 return `${resultQueryUrl(code)}/breakdown?page=${page}&sort=${sort}${jump?'&jump=winner':''}`;
}

export function participantPageKey(code:string,amount:string){return `result:${code}:${amount}`}

export function resultParticipantsQueryUrl(code:string,amount:string,page:number){
 return `${resultQueryUrl(code)}/breakdown?amount=${encodeURIComponent(amount)}&page=${page}`;
}

export function prefetchResultNumbers(identity:string|null,code:string){
 if(identity)void prefetchPrivateQuery(identity,resultNumbersQueryUrl(code,miniNavigationState.result(identity,code)));
}

export function prefetchResultParticipants(identity:string|null,code:string,amount:string){
 if(identity)void prefetchPrivateQuery(identity,resultParticipantsQueryUrl(code,amount,miniNavigationState.page(identity,participantPageKey(code,amount))));
}
