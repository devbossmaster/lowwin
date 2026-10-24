'use client';
import {BidForm} from './bid-form';
type Props={slug:string;title:string;active?:boolean;onInteractionChange?:(active:boolean)=>void};
// Retained callers use the same direct-payment flow as auction details.
export function FeaturedBid({slug,title,active=true}:Props){return active?<BidForm slug={slug} title={title} status="live" isDemo={false} compact/>:null}
