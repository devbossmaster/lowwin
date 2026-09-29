import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CatalogImage } from './catalog-image';
import type { CatalogAuction } from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
export function resultTitle(auction:CatalogAuction) {
  return !auction.result?'Closing / result pending':auction.result.outcome==='WINNER'?`${formatEtb(auction.result.winningPoints!)} · ${auction.result.decision==='FIRST_ACCEPTED_LOWEST'?'first accepted lowest amount':'lowest unique'}`:auction.result.outcome==='NO_WINNER'?'No winner':'Cancelled';
}
export function ResultCard({auction}:{auction:CatalogAuction}) {
  return <Link className="result-card" href={`/winners/${auction.code}`}><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/><div>{(auction.result?.demoLabel||auction.isDemo)&&<small className="demo-label">{auction.result?.demoLabel??'DEMO'}</small>}<h2>{auction.product.title}</h2><small className="card-code">{auction.code}</small><p className="result-outcome">{resultTitle(auction)}</p><small>{auction.result?'Closed':'Scheduled end'} {new Date(auction.result?.closedAt??auction.endsAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'})} EAT</small><span>View outcome <ArrowRight size={15}/></span></div></Link>;
}
