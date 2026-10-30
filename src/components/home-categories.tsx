'use client';
import {IntentPrefetchLink as Link} from './intent-prefetch-link';
import {MiniCategoryName,MiniPhrase} from './mini-locale';
import styles from './home-banner.module.css';
import type {CatalogQuery} from '@/modules/auctions/catalog';
import {auctionBrowseHref} from '@/modules/auctions/browse-links';
import {homeAuctionHref} from './home-auctions';
import {HomeFilterLink} from './home-filter-link';
type Category={slug:string;name:string;nameAm:string|null;counts:{all:number}};
export function HomeCategories({categories,query,home=false}:{categories:Category[];query?:CatalogQuery;home?:boolean}){
 const CategoryLink=home?HomeFilterLink:Link;
 return <nav className={styles.categories} aria-label="Auction categories"><CategoryLink className={!query?.category?styles.allCategory:undefined} aria-current={!query?.category?'page':undefined} href={query?(home?homeAuctionHref(query,{category:undefined,page:1}):auctionBrowseHref(query,{category:undefined,page:1})):'/auctions/all'}><MiniPhrase en="All" am="ሁሉም"/></CategoryLink>{categories.map(category=><CategoryLink className={query?.category===category.slug?styles.allCategory:undefined} aria-current={query?.category===category.slug?'page':undefined} key={category.slug} href={query?(home?homeAuctionHref(query,{category:category.slug,page:1}):auctionBrowseHref(query,{category:category.slug,page:1})):`/categories/${encodeURIComponent(category.slug)}`}><MiniCategoryName slug={category.slug} name={category.name} nameAm={category.nameAm}/></CategoryLink>)}</nav>;
}
