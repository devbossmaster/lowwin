import Link from 'next/link';
import { ArrowRight, Check, X, ArrowUpRight, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IdentityState } from '@/components/identity-state';
export default function Home() {
  return <>
    <section className="home-intro">
      <div className="intro-top"><Link href="/faq">How it works</Link><Link href="/auctions">Auctions <ArrowUpRight size={15}/></Link></div>
      <h1>Small is good.<br/><em>Unique is better.</em></h1>
      <p>It’s not just the lowest bid. It’s the lowest bid that <strong>nobody else chose.</strong></p>
      <Button asChild><Link href="/auctions">Explore auctions <ArrowRight size={18}/></Link></Button>
      <div className="rule-demonstration" aria-label="Illustrative example: 1 point has two bids, 2 points has one and wins, 3 points has two, 4 points has one.">
        <div className="demo-heading"><span>What makes a winning bid?</span><span>Example</span></div>
        <div className="bid-examples">{[{ n: 1, count: 2 },{ n: 2, count: 1 },{ n: 3, count: 2 },{ n: 4, count: 1 }].map(({ n, count }) => <div key={n} className={`example ${n === 2 ? 'winning-example' : ''}`}><div className="bid-amount">{n}<span>pts</span></div><span className="bid-count">{count} {count === 1 ? 'bid' : 'bids'}</span><div className="example-mark">{n === 2 ? <Check size={17}/> : count === 2 ? <X size={14}/> : <span className="unique-dot"/>}</div></div>)}</div>
        <p><span className="winner-label">2 points wins</span> The lowest amount placed just once.</p>
      </div>
    </section>
    <section className="home-how"><div className="section-heading"><h2>A few things to know</h2><Link href="/faq" aria-label="Read all rules"><ArrowUpRight size={21}/></Link></div>
      <div className="rule-row"><span className="rule-number">01</span><div><h3>Find something you love</h3><p>Read the item details and point terms before you bid.</p></div></div>
      <div className="rule-row"><span className="rule-number">02</span><div><h3>Choose your own numbers</h3><p>Place up to 100 different point bids. Your largest bid is reserved, not the sum.</p></div></div>
      <div className="rule-row"><span className="rule-number">03</span><div><h3>Let unique decide</h3><p>At close, the lowest unique amount wins. No unique amount? No winner.</p></div></div>
    </section>
    <div className="page-inset"><IdentityState/><div className="quiet-note"><LockKeyhole size={16}/><p>Your bids stay private while an auction is live.</p></div></div>
  </>;
}
