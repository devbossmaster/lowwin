'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import ResultSheet from './result-sheet';
import {WinnersClientList} from './winners-client-list';

/** Notifications open the exact result, with a useful Winners page on close. */
export function WinnerResultRoute({auction}:{auction:CatalogAuction}){
 const router=useRouter(),[open,setOpen]=useState(true);
 return <><WinnersClientList/>{open&&<ResultSheet auction={auction} onClose={()=>{setOpen(false);router.replace('/winners',{scroll:false})}}/>}</>;
}
