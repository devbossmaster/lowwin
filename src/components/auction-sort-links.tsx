import Link from 'next/link';
import {ArrowDownUp} from 'lucide-react';
import type {CatalogQuery} from '@/modules/auctions/catalog';
import {auctionBrowseHref} from '@/modules/auctions/browse-links';
import {MiniPhrase} from './mini-locale';
import styles from './auction-sort-links.module.css';

export function AuctionSortLinks({query,home=false}:{query:CatalogQuery;home?:boolean}){
 return <nav className={styles.sorts} aria-label="Sort auctions">{([
  ['newest','Newest','አዲስ'],['ending','Closing soon','በቅርቡ የሚያበቁ'],
  ['fee-low','Lowest fee','ዝቅተኛ ክፍያ'],['fee-high','Highest fee','ከፍተኛ ክፍያ'],
 ] as const).map(([sort,en,am])=><Link key={sort} href={home?`/?sort=${sort}#discover-auctions`:auctionBrowseHref(query,{sort,page:1})} scroll={false} aria-current={query.sort===sort?'page':undefined}>{query.sort===sort&&<ArrowDownUp size={13} aria-hidden="true"/>}<MiniPhrase en={en} am={am}/></Link>)}</nav>;
}
