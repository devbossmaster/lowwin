'use client';
import Link from 'next/link';
import {MiniCategoryName,MiniPhrase} from './mini-locale';
import styles from './home-banner.module.css';
import type {CatalogQuery} from '@/modules/auctions/catalog';
import {auctionBrowseHref} from '@/modules/auctions/browse-links';
type Category={slug:string;name:string;nameAm:string|null;counts:{all:number}};
export function HomeCategories({categories,query}:{categories:Category[];query?:CatalogQuery}){
 return <nav className={styles.categories} aria-label="Auction categories"><Link className={!query?.category?styles.allCategory:undefined} aria-current={!query?.category?'page':undefined} href={query?auctionBrowseHref(query,{category:undefined,page:1}):'/auctions/all'}><MiniPhrase en="All auctions" am="ሁሉም ጨረታዎች"/></Link>{categories.map(category=><Link className={query?.category===category.slug?styles.allCategory:undefined} aria-current={query?.category===category.slug?'page':undefined} key={category.slug} href={query?auctionBrowseHref(query,{category:category.slug,page:1}):`/categories/${encodeURIComponent(category.slug)}`}><MiniCategoryName slug={category.slug} name={category.name} nameAm={category.nameAm}/></Link>)}</nav>;
}
