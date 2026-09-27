'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { usePrivateQuery,PrivateState,PersonalPagination } from '@/components/private-query';
import { FavoriteButton } from '@/components/favorite-button';
import { AuctionCard } from '@/components/auction-card';
import { OfflineRetry } from '@/components/offline-retry';
import type { getFavorites } from '@/modules/profile/personal';
export default function Favorites() {
  const [page,setPage]=useState(1),query=usePrivateQuery<Awaited<ReturnType<typeof getFavorites>>>(`/api/favorites?page=${page}`),data=query.data;
  return <><OfflineRetry/><section className="page-inset"><Link className="back-link" href="/profile"><ArrowLeft size={16}/> Profile</Link><h1 className="page-title">Favorites<span className="title-dot">.</span></h1><p className="page-lead">Saved to your account, ready for your next visit.</p><PrivateState query={query}/>{data&&<><div className="listing-count">{data.total} saved {data.total===1?'auction':'auctions'}</div>{data.items.length===0&&<div className="empty-state"><h2>Save something you like</h2><p>Tap “Save to favorites” on an auction to find it here.</p><Link className="text-link" href="/auctions">Browse auctions</Link></div>}<div className="favorites-list">{data.items.map(auction=><div key={auction.code}><AuctionCard auction={auction} serverNow={data.serverNow} onFavoriteChanged={query.reload}/></div>)}</div><PersonalPagination page={page} totalPages={data.totalPages} setPage={setPage}/></>}</section></>;
}
