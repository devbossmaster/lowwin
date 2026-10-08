'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {TelegramLink} from './telegram-link';
import {usePathname,useRouter} from 'next/navigation';
import {ChevronDown,Menu,Search,X} from 'lucide-react';
import {LanguageSwitch,MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './mini-navigation.module.css';

export function MiniNavigation(){
  const [open,setOpen]=useState<'menu'|'search'|null>(null);
  const [term,setTerm]=useState('');
  const root=useRef<HTMLDivElement>(null),menuButton=useRef<HTMLButtonElement>(null),searchButton=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null);
  const path=usePathname(),router=useRouter(),{language}=useMiniLocale(),am=language==='am';
  useEffect(()=>setOpen(null),[path]);
  useEffect(()=>{
    if(!open)return;
    if(open==='search')input.current?.focus();
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(null)};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(null);(open==='menu'?menuButton:searchButton).current?.focus()}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape)};
  },[open]);
  const close=()=>setOpen(null);
  return <div ref={root} className={`${styles.navigation} mini-global-navigation`}>
    <div className={styles.toolbar}>
      <button ref={searchButton} type="button" aria-label={am?'ጨረታ ፈልግ':'Search auctions'} aria-expanded={open==='search'} aria-controls="mini-search" onClick={()=>setOpen(open==='search'?null:'search')}><Search size={22}/></button>
      <button ref={menuButton} type="button" aria-label={open==='menu'?(am?'ምናሌውን ዝጋ':'Close menu'):(am?'ምናሌውን ክፈት':'Open menu')} aria-expanded={open==='menu'} aria-controls="mini-global-menu" onClick={()=>setOpen(open==='menu'?null:'menu')}>{open==='menu'?<X size={30}/>:<Menu size={30}/>}</button>
    </div>
    {open==='search'&&<form id="mini-search" className={styles.search} role="search" onSubmit={event=>{event.preventDefault();const q=term.trim();close();router.push(q?`/auctions/all?q=${encodeURIComponent(q)}`:'/auctions/all')}}>
      <input ref={input} type="search" aria-label={am?'ጨረታ ፈልግ':'Search auctions'} placeholder={am?'የምርት ስም፣ ሞዴል ፈልግ…':'Search for brand, model…'} value={term} onChange={event=>setTerm(event.target.value)} maxLength={80}/>
      <button type="submit" aria-label={am?'ፈልግ':'Submit search'}><Search size={18}/></button>
    </form>}
    {open==='menu'&&<><button className={styles.backdrop} tabIndex={-1} aria-label="Close menu" onClick={close}/><nav id="mini-global-menu" className={styles.menu} aria-label="Explore Lowwin">
      <div className={styles.menuLanguage}><LanguageSwitch/></div>
      <details open><summary><MiniPhrase en="Home" am="መነሻ"/><ChevronDown size={17}/></summary><div className={styles.homeLinks}>
        <IntentPrefetchLink href="/" onClick={close}><MiniPhrase en="Home" am="መነሻ"/></IntentPrefetchLink>
        <IntentPrefetchLink href="/#how-lowwin-works" onClick={close}><MiniPhrase en="How It Works" am="እንዴት ይሰራል"/></IntentPrefetchLink>
        <IntentPrefetchLink href="/faq#terms" onClick={close}><MiniPhrase en="Terms & Conditions" am="ውሎች እና ደንቦች"/></IntentPrefetchLink>
      </div></details>
      <IntentPrefetchLink href="/winners/all" onClick={close}><MiniPhrase en="Winners" am="አሸናፊዎች"/></IntentPrefetchLink>
      <IntentPrefetchLink href="/auctions/all" onClick={close}><MiniPhrase en="Auctions" am="ጨረታዎች"/></IntentPrefetchLink>
      <Link prefetch={false} href="/wallet" onClick={close}><MiniPhrase en="Wallet" am="የገንዘብ ቦርሳ"/></Link>
      <IntentPrefetchLink href="/faq" onClick={close}><MiniPhrase en="FAQ" am="ተደጋጋሚ ጥያቄዎች"/></IntentPrefetchLink>
      <TelegramLink onClick={close}><MiniPhrase en="Contact Us" am="ያግኙን"/></TelegramLink>
    </nav></>}
  </div>;
}
