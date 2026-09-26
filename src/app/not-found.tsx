import Link from 'next/link';
import { Button } from '@/components/ui/button';
export default function NotFound() { return <section className="page-inset empty-state"><h1>This page isn’t here</h1><p>Let’s take you back to Lowin.</p><Button asChild><Link href="/">Back home</Link></Button></section>; }
