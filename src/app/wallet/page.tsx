'use client';
import { useTelegram } from '@/components/telegram-provider';
import { IdentityState } from '@/components/identity-state';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
export default function Wallet() { const { me } = useTelegram(); return <section className="page-inset"><h1 className="page-title">Your point wallet</h1><p className="page-lead">One balance. Every point accounted for.</p>{me ? <div className="wallet-summary"><span>Available points</span><strong>{me.wallet.available}<small>pts</small></strong><div><span>Held for auctions</span><b>{me.wallet.held} pts</b></div></div> : <IdentityState/>}<div className="empty-state"><h2>Top up coming later</h2><p>Point funding isn’t enabled yet. There is no payment-to-point rate, transfer or withdrawal flow.</p><Link className="text-link" href="/faq">Understand point holds <ArrowUpRight size={16}/></Link></div></section>; }
