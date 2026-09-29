'use client';
import {LoadingSpinner} from '@/components/loading-spinner';

import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {LockKeyhole} from 'lucide-react';
export async function staffRequest(action:string,body:unknown){const response=await fetch(`/api/auth/lowin/staff/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error??data.message??'Staff authentication failed.');return data}
export function StaffLogin(){const router=useRouter(),[mode,setMode]=useState('login'),[token,setToken]=useState(''),[secret,setSecret]=useState(''),[codes,setCodes]=useState<string[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>{setReady(true);const acceptLink=()=>{const hash=new URLSearchParams(location.hash.slice(1));for(const kind of ['invite','reset'])if(hash.has(kind)){setMode(kind);setToken(hash.get(kind)!);history.replaceState(null,'',location.pathname)}};acceptLink();window.addEventListener('hashchange',acceptLink);return()=>window.removeEventListener('hashchange',acceptLink)},[]);
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);try{
    const action=mode==='invite'?'accept-invite':mode==='challenge'||mode==='enroll'?'mfa':mode;
    const body=mode==='invite'||mode==='reset'?{token,password:form.get('password')}:mode==='login'?{email:form.get('email'),password:form.get('password')}:mode==='forgot'?{email:form.get('email')}:{code:form.get('code')};
    const result=await staffRequest(action,body);setMessage(result.message??'');
    if(result.mode==='enroll'){const enrollment=await staffRequest('enroll',{});setSecret(enrollment.secret);setMode('enroll')}
    else if(result.recoveryCodes){setCodes(result.recoveryCodes);setMode('recovery')}
    else if(result.mode==='authenticated'){router.replace('/admin');router.refresh()}
    else if(result.mode)setMode(result.mode);
  }catch(err){setError(err instanceof Error?err.message:'Please retry.')}finally{setBusy(false)}}
  const title=mode==='login'?'Your workspace, securely.':mode==='invite'?'Accept your Owner invitation':mode==='enroll'?'Connect your authenticator':mode==='challenge'?'Confirm it’s you':mode==='recovery'?'Keep your recovery codes safe':mode==='forgot'?'Reset your password':'Choose a new password';
  return <main id="main" className="admin-access"><div className="admin-access-brand"><span className="admin-wordmark">lowwin</span><p>Thoughtful auctions.<br/>Careful operations.</p><small>Invite-only administration</small></div><section className="admin-access-form"><LockKeyhole size={30}/><h1>{title}</h1><p>{mode==='login'?'Sign in with your staff credentials, then confirm your authenticator.':mode==='enroll'?'Add this setup key to a TOTP authenticator (6 digits, 30 seconds). This session has no admin access yet.':mode==='challenge'?'Enter a fresh six-digit code. A recovery code requires new authenticator enrollment.':mode==='recovery'?'Each recovery code is single-use. Recovery revokes sessions and requires a new authenticator. These codes are shown only once.':'Use the verified email address on your staff invitation.'}</p>
    {secret&&mode==='enroll'&&<div className="admin-secret"><span>Authenticator setup key</span><code>{secret}</code></div>}
    {message&&<p role="status" className="admin-notice">{message}</p>}{error&&<p role="alert" className="admin-error">{error}</p>}
    {mode==='recovery'?<><pre className="admin-codes">{codes.join('\n')}</pre><button onClick={()=>{router.replace('/admin');router.refresh()}}>I saved my codes · Open workspace</button></>:<form onSubmit={submit}>
    {(mode==='login'||mode==='forgot')&&<label>Staff email<input name="email" type="email" autoComplete="username" required/></label>}
    {['login','invite','reset'].includes(mode)&&<label>Password<input name="password" aria-label="Password" aria-describedby="staff-password-hint" type="password" minLength={12} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} required/><small id="staff-password-hint">At least 12 characters.</small></label>}
    {['challenge','enroll'].includes(mode)&&<label>Authenticator or recovery code<input name="code" autoComplete="one-time-code" inputMode={mode==='enroll'?'numeric':'text'} required minLength={6}/></label>}
    <button disabled={!ready||busy}>{busy?<LoadingSpinner/>:mode==='forgot'?'Send reset instructions':mode==='login'?'Continue':mode==='enroll'||mode==='challenge'?'Verify authenticator':'Save password'}</button></form>}
    {mode==='login'&&<button className="admin-text-button" onClick={()=>{setMode('forgot');setMessage('');setError('')}}>Forgot password?</button>}{mode==='forgot'&&<button className="admin-text-button" onClick={()=>setMode('login')}>Back to sign in</button>}
    <p className="admin-access-note">No public staff registration. Production email delivery remains unavailable until a provider is configured.</p></section></main>;
}
