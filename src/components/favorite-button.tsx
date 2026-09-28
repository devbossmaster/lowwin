'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import {useMiniNotice} from './mini-notice';
import {useMiniLocale} from './mini-locale';
import { usePrivateQuery } from './private-query';
export function FavoriteButton({slug,onChanged,compact=false}:{slug:string;onChanged?:()=>void;compact?:boolean}) {
  const notify=useMiniNotice();const {language}=useMiniLocale();const am=language==='am';
  const query=usePrivateQuery<{saved:boolean}>(`/api/favorites/${slug}`);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function toggle() {
    if(!query.data)return;setBusy(true);setError('');
    try{const response=await fetch(`/api/favorites/${slug}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({saved:!query.data.saved}),cache:'no-store'});if(!response.ok)throw new Error('Could not update favorite. Please retry.');notify(query.data.saved?(am?'ከተወዳጆች ተወግዷል።':'Removed from favorites.'):(am?'ወደ ተወዳጆች ተቀምጧል።':'Saved to favorites.'),'success');query.reload();onChanged?.()}catch(cause){const message=cause instanceof Error?cause.message:'Connection interrupted.';setError(message);notify(message,'error')}finally{setBusy(false)}
  }
  if(query.status!=='authenticated')return <Link className="favorite-button" href="/profile" aria-label="Sign in to save"><Heart size={18}/>{!compact&&'Sign in to save'}</Link>;
  return <div className="favorite-control"><button className={`favorite-button ${compact?'compact-favorite':''}`} aria-label={compact?(query.data?.saved?'Remove from favorites':'Save to favorites'):undefined} aria-pressed={query.data?.saved??false} disabled={busy||(!query.data&&!query.error)} onClick={()=>{if(query.error){notify(query.error,'error');query.reload()}else void toggle()}}><Heart size={18} fill={query.data?.saved?'currentColor':'none'}/>{!compact&&(busy?'Saving…':query.data?.saved?'Saved to favorites':'Save to favorites')}</button>{!compact&&(error||query.error)&&<p className="field-error" role="alert">{error||query.error} <button className="retry-action" onClick={query.reload}>Retry</button></p>}</div>;
}
