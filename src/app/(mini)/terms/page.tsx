import {LegalPage} from '@/components/help-pages';
import {termsDocument} from '@/content/help';
import {publicLegalContent} from '@/modules/admin/public-content';
import {requireCustomerPage} from '@/modules/auth/customer-page';
export default async function Terms(){await requireCustomerPage('/terms');return <LegalPage document={await publicLegalContent('terms')??termsDocument} kind="terms"/>}
