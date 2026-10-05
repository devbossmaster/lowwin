'use client';
import Link from 'next/link';
import {ArrowRight,ArrowUpRight} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {CatalogImage} from './catalog-image';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import styles from './home-banner.module.css';
type Copy={headline:string;headlineAm:string;lead:string;leadAm:string};
export function HomeHero({copy,items}:{copy:Copy;items:CatalogAuction[]}){
 const {language}=useMiniLocale(),am=language==='am';
 const showcase=items.slice(0,3);
 return <section className={styles.hero} aria-labelledby="home-headline">
  <div className={styles.heroCopy}><h1 id="home-headline"><MiniPhrase en={copy.headline} am={copy.headlineAm}/></h1><p><MiniPhrase en={copy.lead} am={copy.leadAm}/></p></div>
  {showcase.length>0&&<div className={styles.showcase} aria-label={am?'የጨረታ ዕቃዎች':'Explore auction items'}>{showcase.map((item,index)=>{
   const title=am?(item.product.titleAm?.trim()||item.product.title):item.product.title;
   return <Link className={styles.showcaseItem} data-position={index} href={`/auctions/${item.code}`} key={item.code} aria-label={`${am?'ይመልከቱ':'View'} ${title}`}><CatalogImage src={item.product.images[0]?.path} alt={title}/><span>{title}<ArrowUpRight size={15}/></span></Link>;
  })}</div>}
  <Link href="/auctions/all" className={styles.heroAction} aria-label={am?'የLowwin ጨረታዎችን ይመልከቱ':'Explore Lowwin auctions'}><MiniPhrase en="Explore auctions" am="ጨረታዎችን ይመልከቱ"/><ArrowRight size={19}/></Link>
  <Link className={styles.heroHelp} href="/faq"><MiniPhrase en="How does it work?" am="እንዴት ይሰራል?"/><ArrowUpRight size={15}/></Link>
 </section>;
}
