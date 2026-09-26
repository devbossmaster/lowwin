import Link from 'next/link';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
export default function Auctions() { return <section className="page-inset"><h1 className="page-title">Find your next<br/><em>little possibility.</em></h1><p className="page-lead">Good things are worth a thoughtful bid.</p><div className="empty-state"><LayoutGrid size={36} strokeWidth={1.3}/><h2>The catalog is on its way</h2><p>There are no published auctions to browse yet. Bidding will become available after the catalog and point controls are ready.</p><Button variant="outline" asChild><Link href="/faq">Learn how bidding works <ArrowRight size={16}/></Link></Button></div></section>; }
