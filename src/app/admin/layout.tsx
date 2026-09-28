import './admin.css';
import {LanguageSwitch} from '@/components/mini-locale';
export const metadata={title:'Lowwin administration',robots:{index:false,follow:false}};
export default function AdminLayout({children}:{children:React.ReactNode}){return <div className="admin-root"><LanguageSwitch/>{children}</div>}
