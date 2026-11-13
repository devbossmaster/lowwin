import {redirect} from 'next/navigation';
import {requireCustomerPage} from '@/modules/auth/customer-page';
export default async function FAQ(){await requireCustomerPage('/faq');redirect('/#how-lowwin-works')}
