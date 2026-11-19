import {AdminOverview} from '@/components/admin-overview';
import {StaffWorkspace} from './staff-workspace';

export default function Page(){
  return <StaffWorkspace signIn><AdminOverview/></StaffWorkspace>;
}
