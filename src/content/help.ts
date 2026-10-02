export type BilingualText={en:string;am:string};
export type FaqEntry={id:string;question:BilingualText;answer:BilingualText};
export type LegalDocument={title:BilingualText;intro?:BilingualText;closing?:BilingualText;effectiveDate?:string;updatedDate?:string;sections:{id:string;title:BilingualText;paragraphs:BilingualText[]}[]};
// Awaiting the owner's PDFs: do not invent policy text or publication dates.
export {termsDocument,faqEntries} from './help-policy';
export const privacyDocument:LegalDocument={title:{en:'Privacy Policy',am:'የግላዊነት ፖሊሲ'},sections:[]};
