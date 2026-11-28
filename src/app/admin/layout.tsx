import {AdminActionToastHost} from '@/components/admin-action-toast';
import './admin.css';
export const metadata={title:'Lowwin administration',robots:{index:false,follow:false}};
export default function AdminLayout({children}:{children:React.ReactNode}){return <><AdminActionToastHost/><div className="admin-root">{children}</div></>}
