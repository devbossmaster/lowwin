'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {LayoutDashboard,Gavel,CreditCard,Users,Settings,LogOut,Menu,X,ChevronRight,ShieldCheck} from 'lucide-react';
import {activeTask,adminAreas,allowedTasks,areaLanding,roleLabels,type AdminAccess} from '@/modules/admin/navigation';
const AccessContext=createContext<AdminAccess|null>(null);
export function useAdminAccess(){const access=useContext(AccessContext);if(!access)throw Error('Admin access context is required.');return access;}
const icons={Overview:LayoutDashboard,Auctions:Gavel,Payments:CreditCard,People:Users,Settings};
export function AdminShell({children,access}:{children:React.ReactNode;access:AdminAccess}){
 const path=usePathname(),router=useRouter(),task=activeTask(path),tasks=allowedTasks(access.role).filter(t=>t.area===task.area),[open,setOpen]=useState(false),[error,setError]=useState('');const drawer=useRef<HTMLElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>setOpen(false),[path]);
 useEffect(()=>{if(!open)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';drawer.current?.querySelector<HTMLButtonElement>('button')?.focus();function key(e:KeyboardEvent){if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}if(e.key==='Tab'){const nodes=drawer.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key)}},[open]);
 return <AccessContext.Provider value={access}><div className="admin-frame">
 {open&&<button className="admin-scrim" aria-label="Close navigation" onClick={()=>{setOpen(false);trigger.current?.focus()}}/>}
 <aside ref={drawer} className={`admin-sidebar ${open?'is-open':''}`} aria-label="Workspace navigation">
 <button className="admin-menu-close secondary" onClick={()=>{setOpen(false);trigger.current?.focus()}}><X size={18}/>Close menu</button>
 <Link href="/admin" className="admin-wordmark" aria-label="Lowin administration"><strong className="admin-brand-name"><img src="/logo.png" width={36} height={36} alt=""/>Lowin</strong><span>Business workspace</span></Link><p className="admin-nav-caption">Manage your business</p>
 <nav aria-label="Business areas">{adminAreas.filter(a=>a!=='Settings').map(area=>{const href=areaLanding(access.role,area),Icon=icons[area];return href&&<Link key={area} href={href} aria-current={task.area===area?'page':undefined}><Icon size={20}/><span>{area}</span>{task.area===area&&<ChevronRight size={16}/>}</Link>})}</nav>
 <div className="admin-sidebar-foot">{areaLanding(access.role,'Settings')&&<Link className="admin-settings-link" href={areaLanding(access.role,'Settings')!} aria-current={task.area==='Settings'?'page':undefined}><Settings size={19}/>Settings</Link>}<div className="admin-staff"><span className="admin-staff-avatar">{roleLabels[access.role][0]}</span><p><strong>{roleLabels[access.role]}</strong><small>Staff workspace</small></p></div><button className="admin-signout" onClick={async()=>{setError('');try{const r=await fetch('/api/auth/lowin/staff/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('Sign out failed. Try again.');router.replace('/admin/login');router.refresh()}catch(e){setError((e as Error).message)}}}><LogOut size={18}/>Sign out</button>{error&&<p role="alert" className="admin-error">{error}</p>}</div></aside>
 <div className="admin-workspace"><header className="admin-topbar"><button ref={trigger} className="admin-menu-button secondary" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={20}/>Menu</button><nav aria-label="Breadcrumb"><Link href="/admin">Workspace</Link><ChevronRight size={14}/><span>{task.area}</span>{task.label!==task.area&&<><ChevronRight size={14}/><Link href={task.href}>{task.label}</Link></>}{path!==task.href&&<><ChevronRight size={14}/><span>{path.endsWith('/new')?'Create':'Details'}</span></>}</nav><span className="admin-assurance"><ShieldCheck size={15}/>Staff access · MFA verified</span></header>
 {tasks.length>1&&<nav className="admin-context-tabs" aria-label={`${task.area} tasks`}>{tasks.map(t=><Link key={t.href} href={t.href} aria-current={t.href===task.href?'page':undefined}>{t.label}</Link>)}</nav>}
 <main id="main" className="admin-main" key={path}>{children}</main></div></div></AccessContext.Provider>;
}
