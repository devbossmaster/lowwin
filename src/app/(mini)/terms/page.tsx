import {LegalPage} from '@/components/help-pages';
import {termsDocument} from '@/content/help';
import {publicLegalContent} from '@/modules/admin/public-content';
export default async function Terms(){return <LegalPage document={await publicLegalContent('terms')??termsDocument} kind="terms"/>}
