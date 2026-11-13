import {LegalPage} from '@/components/help-pages';
import {privacyDocument} from '@/content/help';
import {publicLegalContent} from '@/modules/admin/public-content';
import {requireCustomerPage} from '@/modules/auth/customer-page';
export default async function Privacy(){await requireCustomerPage('/privacy');return <LegalPage document={await publicLegalContent('privacy')??privacyDocument} kind="privacy"/>}
