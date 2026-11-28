'use client';

import {useRef,useState,type FormEvent} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {KeyRound,LogOut,Mail,ShieldCheck} from 'lucide-react';
import {AdminHeading,ErrorNotice} from './admin-ui';
import {adminRequest,clearAdminCache,signOutAdmin,useAdminQuery} from './admin-query';
import {notifyAdminAction} from './admin-action-toast';

type ProfileAction = 'change-email' | 'change-password' | 'sign-out';

export function AdminProfile() {
  const router = useRouter();
  const search = useSearchParams();
  const profile = useAdminQuery<{email:string}>('profile');
  const [busy,setBusy] = useState<ProfileAction|null>(null);
  const [error,setError] = useState('');
  const [emailSent,setEmailSent] = useState(false);
  const pending = useRef(false);

  async function run(action:ProfileAction,submit:()=>Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(action);
    setError('');
    try {
      await submit();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request failed. Try again.');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  function returnToLogin() {
    router.replace('/admin/login');
    router.refresh();
  }

  async function changeEmail(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const newEmail = String(new FormData(form).get('email') ?? '').trim();
    await run('change-email',async () => {
      setEmailSent(false);
      await adminRequest('profile',{action:'change-email',newEmail});
      setEmailSent(true);
      form.reset();
    });
  }

  async function changePassword(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const currentPassword = String(fields.get('currentPassword') ?? '');
    const newPassword = String(fields.get('newPassword') ?? '');
    await run('change-password',async () => {
      if (newPassword!==fields.get('confirmPassword')) throw Error('The new passwords do not match.');
      await adminRequest('profile',{action:'change-password',currentPassword,newPassword});
      form.reset();
      clearAdminCache();
      notifyAdminAction('Password changed. Sign in with your new password.');
      returnToLogin();
    });
  }

  const emailLinkFailed = search.get('emailChange')==='invalid'||search.has('error');
  return <>
    <AdminHeading title="Profile">
      <button type="button" className="secondary" disabled={busy!==null} onClick={() => void run('sign-out',async () => {
        await signOutAdmin();
        returnToLogin();
      })}><LogOut size={17}/>{busy==='sign-out'?'Signing out…':'Sign out'}</button>
    </AdminHeading>
    <ErrorNotice error={profile.error} retry={profile.reload}/>
    <ErrorNotice error={error||(emailLinkFailed?'The email change link is invalid or expired. Request a new link below.':'')}/>
    <div className="admin-profile-panels">
      <section className="admin-panel" aria-labelledby="admin-profile-email">
        <h2 id="admin-profile-email"><Mail size={18} aria-hidden="true"/> Email address</h2>
        {profile.data&&<div className="admin-profile-email"><strong>{profile.data.email}</strong><span><ShieldCheck size={14} aria-hidden="true"/>Verified</span></div>}
        {!profile.data&&profile.loading&&<div className="admin-profile-skeleton" role="status"><span className="sr-only">Loading email address</span></div>}
        <form className="admin-form" onSubmit={changeEmail}>
          <label>New email address<input name="email" type="email" autoComplete="email" required maxLength={254} readOnly={busy!==null}/></label>
          <p>Approve the change in your current inbox, then verify the new address. Open both links in your signed-in browser.</p>
          <button type="submit" disabled={busy!==null||!profile.data}>{busy==='change-email'?'Sending…':'Send confirmation'}</button>
          {emailSent&&<p className="admin-profile-confirmation" role="status">If the new address is available, a confirmation link will arrive in your current inbox.</p>}
          {!emailSent&&search.get('emailChange')==='verify-new'&&<p className="admin-profile-confirmation" role="status">Change approved. Open the link in your new inbox to verify that address and sign in again.</p>}
        </form>
      </section>
      <section className="admin-panel" aria-labelledby="admin-profile-password">
        <h2 id="admin-profile-password"><KeyRound size={18} aria-hidden="true"/> Password</h2>
        <form className="admin-form" onSubmit={changePassword}>
          <label>Current password<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={128} readOnly={busy!==null}/></label>
          <label>New password<input type="password" name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128} readOnly={busy!==null}/></label>
          <label>Confirm new password<input type="password" name="confirmPassword" autoComplete="new-password" required minLength={12} maxLength={128} readOnly={busy!==null}/></label>
          <p>Use at least 12 characters. Changing your password signs you out on every device.</p>
          <button type="submit" disabled={busy!==null||!profile.data}>{busy==='change-password'?'Saving…':'Change password'}</button>
        </form>
      </section>
    </div>
  </>;
}
