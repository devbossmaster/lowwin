'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { usePrivateQuery } from './private-query';
export function FavoriteButton({slug,onChanged,compact=false}:{slug:string;onChanged?:()=>void;compact?:boolean}) {
  const query=usePrivateQuery<{saved:boolean}>(`/api/favorites/${slug}`);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function toggle() {
    if(!query.data)return;setBusy(true);setError('');
    try{const response=await fetch(`/api/favorites/${slug}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({saved:!query.data.saved}),cache:'no-store'});if(!response.ok)throw new Error('Could not update favorite. Please retry.');query.reload();onChanged?.()}catch(cause){setError(cause instanceof Error?cause.message:'Connection interrupted.')}finally{setBusy(false)}
  }
  if(query.status!=='authenticated')return <Link className="favorite-button" href="/profile" aria-label="Sign in to save"><Heart size={18}/>{!compact&&'Sign in to save'}</Link>;
  return <div className="favorite-control"><button className={`favorite-button ${compact?'compact-favorite':''}`} aria-label={compact?(query.data?.saved?'Remove from favorites':'Save to favorites'):undefined} aria-pressed={query.data?.saved??false} disabled={busy||!query.data} onClick={toggle}><Heart size={18} fill={query.data?.saved?'currentColor':'none'}/>{!compact&&(busy?'Saving…':query.data?.saved?'Saved to favorites':'Save to favorites')}</button>{(error||query.error)&&<p className="field-error" role="alert">{error||query.error} <button className="retry-action" onClick={query.reload}>Retry</button></p>}</div>;
}
