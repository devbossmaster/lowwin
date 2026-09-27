import { notFound } from 'next/navigation';
import { IdentityState } from '@/components/identity-state';
const sections: Record<string, { title: string; text: string }> = { alerts: { title: 'Notifications', text: 'The notification inbox arrives in Phase 5B. No alerts or delivery updates are available yet.' } };
export default async function ProfileSection({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; const data = sections[section]; if (!data) notFound(); return <section className="page-inset"><h1 className="page-title">{data.title}</h1><IdentityState/><div className="empty-state"><p>{data.text}</p></div></section>; }
