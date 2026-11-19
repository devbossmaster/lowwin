import {StaffWorkspace} from '../staff-workspace';

export default function SecureAdmin({children}:{children:React.ReactNode}){
  return <StaffWorkspace>{children}</StaffWorkspace>;
}
