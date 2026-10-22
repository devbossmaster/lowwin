'use client';
import Link from 'next/link';
import {MiniCategoryName,MiniPhrase} from './mini-locale';
import styles from './home-banner.module.css';
type Category={slug:string;name:string;nameAm:string|null;counts:{all:number}};
export function HomeCategories({categories}:{categories:Category[]}){
 return <nav className={styles.categories} aria-label="Auction categories"><Link className={styles.allCategory} href="/auctions/all"><MiniPhrase en="All auctions" am="ሁሉም ጨረታዎች"/></Link>{categories.map(category=><Link key={category.slug} href={`/categories/${encodeURIComponent(category.slug)}`}><MiniCategoryName slug={category.slug} name={category.name} nameAm={category.nameAm}/></Link>)}</nav>;
}
