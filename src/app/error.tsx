'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="page-inset empty-state"><h1>Something interrupted us</h1><p>Your points have not changed because of this screen. Check your connection and try again.</p><Button onClick={reset}>Try again</Button></section>; }
