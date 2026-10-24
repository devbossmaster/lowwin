'use client';
import Link from 'next/link';
import {Clock3} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {AccountSheet} from './account-sheet';
import {CatalogImage} from './catalog-image';
import {AuctionCountdown} from './auction-countdown';
import {BidForm} from './bid-form';
import {MiniPhrase,useMiniLocale} from './mini-locale';
export default function BidSheet({auction,serverNow,onClose}:{auction:CatalogAuction;serverNow:string;onClose:()=>void}){
 const {language}=useMiniLocale(),title=language==='am'?(auction.product.titleAm||auction.product.title):auction.product.title;
 return <AccountSheet title={<MiniPhrase en="Your next bid" am="የእርስዎ ጨረታ"/>} onClose={onClose}>
  <div className="bid-sheet-product"><CatalogImage src={auction.product.images[0]?.path} alt=""/><div><h3>{title}</h3><p><Clock3 size={13}/><AuctionCountdown target={auction.endsAt} serverNow={serverNow} label="Ends"/></p></div></div>
  <BidForm slug={auction.slug} title={title} status={auction.status} isDemo={auction.isDemo} compact/>
  <details className="bid-sheet-terms"><summary><MiniPhrase en="Auction terms & details" am="የጨረታ ውሎች እና ዝርዝሮች"/></summary><p>{language==='am'?(auction.product.descriptionAm||auction.product.description):auction.product.description}</p><p>{auction.terms.noWinnerTerms}</p><p>{auction.terms.cancellationTerms}</p><small>{auction.terms.ruleVersion} · v{auction.terms.version}</small><p><Link href={`/auctions/${auction.code}`}><MiniPhrase en="Full auction details" am="ሙሉ የጨረታ ዝርዝሮች"/></Link></p></details>
  <div className="learn-links"><Link href="/terms"><MiniPhrase en="Terms" am="ውሎች"/></Link><Link href="/privacy"><MiniPhrase en="Privacy" am="ግላዊነት"/></Link></div>
 </AccountSheet>;
}
