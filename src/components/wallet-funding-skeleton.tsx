import {CustomerLoading} from './loading-spinner';

type Variant='deposit'|'deposits'|'preview';
export function WalletFundingSkeleton({variant='deposit'}:{variant?:Variant}){
 return <CustomerLoading en={variant==='deposits'?'Loading your transfers…':'Loading payment details…'} am={variant==='deposits'?'ዝውውሮችዎን በመጫን ላይ…':'የክፍያ ዝርዝሮችን በመጫን ላይ…'} compact/>;
}
