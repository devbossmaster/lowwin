import {LegalPage} from '@/components/help-pages';
import {privacyDocument} from '@/content/help';
import {publicLegalContent} from '@/modules/admin/public-content';
export default async function Privacy(){return <LegalPage document={await publicLegalContent('privacy')??privacyDocument} kind="privacy"/>}
