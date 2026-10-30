'use client';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';

export default function ErrorPage({reset}:{reset:()=>void}){
 return <main className="retry-screen"><section><img src={LOWWIN_LOGO_SRC} data-lowwin-logo alt="Lowwin" width="106" height="106"/><h1>Try again</h1><p>Check your connection.</p><Button onClick={reset}><RotateCcw size={18}/> Retry</Button></section></main>;
}
