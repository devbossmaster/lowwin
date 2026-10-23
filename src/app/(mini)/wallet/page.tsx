import {redirect} from 'next/navigation';

// Keep old links meaningful without restoring customer balances or transfers.
export default function RetiredWallet(){redirect('/payments')}
