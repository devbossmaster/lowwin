'use client';
import {usePathname} from 'next/navigation';
import {CustomerLoading} from './loading-spinner';
import {customerLoadingCopy} from './customer-loading-copy';

// Preserve existing imports while replacing placeholder cards with one readable loading state.
export function CatalogSkeleton(){return <CustomerLoading {...customerLoadingCopy('/auctions')}/>}
export function BidPanelSkeleton(){return <CustomerLoading en="Loading bid details…" am="የጨረታ ዝርዝሮችን በመጫን ላይ…" compact/>}
export function MiniRouteSkeleton(){const path=usePathname()??'/';return <CustomerLoading {...customerLoadingCopy(path)}/>}
export function MiniInlineSkeleton(){const path=usePathname()??'/';return <CustomerLoading {...customerLoadingCopy(path)} compact/>}
