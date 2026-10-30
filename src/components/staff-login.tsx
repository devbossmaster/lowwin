'use client';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowLeft} from 'lucide-react';
import {StaffPasswordField} from './staff-password-field';

const routes:Record<string,string>={login:'sign-in/email',signup:'sign-up/email',forgot:'request-password-reset',reset:'reset-password',verify:'send-verification-email',logout:'sign-out'};
export async function staffRequest(action:string,body:unknown){
 const route=routes[action];if(!route)throw new Error('This authentication action is unavailable.');
 const response=await fetch(`/api/auth/${route}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error?.message??data.error??data.message??'Authentication could not complete. Please retry.');
 return data;
}

type Mode='login'|'signup'|'forgot'|'reset'|'verify';
const titles:Record<Mode,string>={login:'Sign in to Lowwin',signup:'Create your account',forgot:'Reset your password',reset:'Choose a new password',verify:'Check your email'};
export function StaffLogin(){
 const router=useRouter(),[mode,setMode]=useState<Mode>('login'),[token,setToken]=useState(''),[email,setEmail]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
 useEffect(()=>{
  setReady(true);const params=new URLSearchParams(location.search),reset=params.get('token');
  if(reset){setToken(reset);setMode('reset');history.replaceState(null,'',location.pathname)}
  if(params.get('verified')==='1')setMessage('Email verified. Sign in after your administrator access is approved.');
  if(params.has('error'))setError('This email link is invalid or expired. Request a new link.');
 },[]);
 function change(next:Mode){if(busy)return;setMode(next);setMessage('');setError('');setToken('')}
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError('');const form=new FormData(event.currentTarget),address=String(form.get('email')??email).trim().toLowerCase();
  if(address)setEmail(address);
  const loginUrl=new URL('/admin/login',location.origin);
  try{
   if(mode==='login'){
    await staffRequest('login',{email:address,password:form.get('password'),rememberMe:false});router.replace('/admin');router.refresh();return;
   }
   if(mode==='signup'){
    loginUrl.searchParams.set('verified','1');await staffRequest('signup',{name:String(form.get('name')??'').trim(),email:address,password:form.get('password'),callbackURL:loginUrl.href});
    setMode('verify');setMessage('We sent a verification link. Your account starts as a member; administrator access is approved separately.');return;
   }
   if(mode==='forgot'){
    await staffRequest('forgot',{email:address,redirectTo:loginUrl.href});setMessage('If this email is registered, a password reset link has been sent.');return;
   }
   if(mode==='reset'){
    await staffRequest('reset',{token,newPassword:form.get('password')});setToken('');setMode('login');setMessage('Password updated. Sign in with your new password.');return;
   }
   loginUrl.searchParams.set('verified','1');await staffRequest('verify',{email:address,callbackURL:loginUrl.href});setMessage('If this email needs verification, a new link has been sent.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Authentication could not complete. Please retry.')}finally{setBusy(false)}
 }
 return <main id="main" className="admin-access master-admin-auth"><section className="admin-access-form">
  <a className="admin-brand-name" href="/admin/login"><img src={LOWWIN_LOGO_SRC} data-lowwin-logo alt="" width={36} height={36}/>Lowwin</a>
  <h1>{titles[mode]}</h1>
  <p>{mode==='login'?'Use your verified email and password.':mode==='signup'?'Register as a member, verify your email, then wait for administrator approval.':mode==='forgot'?'We will email a link to reset your password.':mode==='reset'?'Set a new password for your account.':'Verify your email before requesting administrator access.'}</p>
  {message&&<p role="status" className="admin-notice">{message}</p>}{error&&<p role="alert" className="admin-error">{error}</p>}
  <form onSubmit={submit} key={mode}>
   {mode==='signup'&&<label>Name<input name="name" autoComplete="name" required minLength={2} maxLength={100}/></label>}
   {mode!=='reset'&&<label>Email<input name="email" type="email" autoComplete="username" defaultValue={email} required maxLength={254} autoFocus/></label>}
   {['login','signup','reset'].includes(mode)&&<label>Password<StaffPasswordField key={mode} autoComplete={mode==='login'?'current-password':'new-password'}/><small>At least 12 characters.</small></label>}
   <button disabled={!ready||busy}>{busy?'Please wait...':mode==='login'?'Sign in':mode==='signup'?'Create account':mode==='forgot'?'Send reset link':mode==='reset'?'Save password':'Resend verification email'}</button>
  </form>
  {mode==='login'?<div className="admin-auth-links"><button className="admin-text-button" onClick={()=>change('signup')} disabled={busy}>Create an account</button><button className="admin-text-button" onClick={()=>change('forgot')} disabled={busy}>Forgot password?</button><button className="admin-text-button" onClick={()=>change('verify')} disabled={busy}>Verify your email</button></div>:<button className="admin-text-button" onClick={()=>change('login')} disabled={busy}><ArrowLeft size={14}/>Back to sign in</button>}
  <p className="admin-access-note">Registration does not grant administrator access. Sessions expire within eight hours.</p>
 </section></main>;
}
