import Link from 'next/link';
import { ChevronRight, Wallet, Trophy, Heart, Bell, CircleHelp } from 'lucide-react';
import { IdentityState } from '@/components/identity-state';
export default function Profile() { return <section className="page-inset"><h1 className="page-title">Your corner<br/>of Lowin.</h1><IdentityState/>
  <div className="profile-links">{[{ href:'/wallet', label:'Point wallet', icon:Wallet },{ href:'/profile/wins',label:'My wins',icon:Trophy },{ href:'/profile/favorites',label:'Favorites',icon:Heart },{ href:'/profile/alerts',label:'Alerts',icon:Bell },{ href:'/faq',label:'How it works & help',icon:CircleHelp }].map(({ href,label,icon:Icon })=><Link key={href} href={href}><Icon size={20}/><span>{label}</span><ChevronRight size={18}/></Link>)}</div></section>; }
