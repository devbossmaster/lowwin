'use client';
import Link from 'next/link';
import {TelegramLink} from './telegram-link';
import {useState} from 'react';
import {ArrowUpRight,CalendarDays,Minus,Plus,Search} from 'lucide-react';
import {LanguageSwitch,useMiniLocale} from './mini-locale';
import {faqEntries,privacyDocument,termsDocument,type LegalDocument} from '@/content/help';
import './help-pages.css';

function HelpNavigation({active}:{active:'faq'|'terms'|'privacy'}){
 const {language}=useMiniLocale();
 const items=[{id:'faq',title:{en:'FAQ',am:'ጥያቄዎች'}},...([{id:'terms',...termsDocument},{id:'privacy',...privacyDocument}].filter(item=>item.sections.length>0))];
 return <nav className="help-navigation" aria-label={language==='am'?'መረጃ':'Information'}>{items.map(item=><Link key={item.id} href={`/${item.id}`} aria-current={active===item.id?'page':undefined}>{item.title[language]}</Link>)}</nav>;
}
function HelpContact(){const {language}=useMiniLocale();return <aside className="help-contact"><div><h2>{language==='am'?'አሁንም ጥያቄ አለዎት?' :'Still have a question?'}</h2><p>{language==='am'?'ቡድናችን ሊረዳዎት ዝግጁ ነው።':'Our team is here to help.'}</p></div><TelegramLink>{language==='am'?'ድጋፍ ያግኙ':'Contact support'}<ArrowUpRight size={18}/></TelegramLink></aside>}

export function FaqPage(){
 const {language}=useMiniLocale(),[search,setSearch]=useState('');
 const query=search.trim().toLocaleLowerCase(),items=faqEntries.filter(item=>`${item.question[language]} ${item.answer[language]}`.toLocaleLowerCase().includes(query));
 return <section className="help-page"><header className="help-hero"><h1>{language==='am'?'ተደጋጋሚ ጥያቄዎች':'Frequently asked questions'}</h1><p>{language==='am'?'ስለ ጨረታ፣ ክፍያ እና አሸናፊዎች መልሶችን ያግኙ።':'A clear guide to bidding, payments and winning.'}</p><LanguageSwitch/></header><div className="help-content"><HelpNavigation active="faq"/><label className="help-search"><Search size={19} aria-hidden="true"/><span className="sr-only">{language==='am'?'ጥያቄዎችን ይፈልጉ':'Search questions'}</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={language==='am'?'ጥያቄዎችን ይፈልጉ…':'Search your question…'}/></label><p className="help-count" role="status">{items.length} {language==='am'?'ጥያቄዎች':'questions'}</p><div className="help-questions">{items.map(item=><details key={item.id} name="lowwin-faq" id={`question-${item.id}`}><summary><span>{item.question[language]}</span><span className="help-toggle" aria-hidden="true"><Plus className="help-plus" size={19}/><Minus className="help-minus" size={19}/></span></summary><p>{item.answer[language]}</p></details>)}</div>{!items.length&&<div className="help-no-results"><h2>{language==='am'?'ተዛማጅ ጥያቄ አልተገኘም':'No matching questions'}</h2><button onClick={()=>setSearch('')}>{language==='am'?'ሁሉንም ጥያቄዎች ይመልከቱ':'Show all questions'}</button></div>}<HelpContact/></div></section>;
}

export function LegalPage({document,kind}:{document:LegalDocument;kind:'terms'|'privacy'}){
 const {language}=useMiniLocale(),date=(value:string)=>new Intl.DateTimeFormat(language==='am'?'am-ET':'en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Addis_Ababa'}).format(new Date(value));
 return <section className="help-page"><header className="help-hero"><h1>{document.title[language]}</h1>{document.sections.length>0&&<p>{language==='am'?'እባክዎ በጥንቃቄ ያንብቡ። ወደ ክፍል ለመሄድ ከታች ያለውን ቁጥር ይምረጡ።':'Please read carefully. Use the numbered links to jump to a section.'}</p>}<LanguageSwitch/></header><div className="help-content"><HelpNavigation active={kind}/>{document.sections.length>0?<><div className="help-dates">{document.effectiveDate&&<span><CalendarDays size={16}/>{language==='am'?'የሚጀምርበት ቀን':'Effective'}: {date(document.effectiveDate)}</span>}{document.updatedDate&&<span>{language==='am'?'የተሻሻለበት ቀን':'Updated'}: {date(document.updatedDate)}</span>}</div>{document.intro&&<p className="legal-intro">{document.intro[language]}</p>}<nav className="legal-jump" aria-label={language==='am'?'ወደ ክፍል ይሂዱ':'Jump to section'}>{document.sections.map((section,index)=><a href={`#${section.id}`} key={section.id} aria-label={`${index+1}. ${section.title[language]}`}>{String(index+1).padStart(2,'0')}</a>)}</nav><div className="legal-sections">{document.sections.map((section,index)=><article className="legal-section" key={section.id} id={section.id} tabIndex={-1}><header><span>{String(index+1).padStart(2,'0')}</span><h2>{section.title[language]}</h2></header><div>{section.paragraphs.map((paragraph,i)=><p key={i}>{paragraph[language]}</p>)}</div></article>)}</div>{document.closing&&<p className="legal-intro">{document.closing[language]}</p>}</>:<div className="help-unpublished"><h2>{language==='am'?'ይህ ሰነድ ገና አልታተመም።':'This document has not been published yet.'}</h2><p>{language==='am'?'ለበለጠ መረጃ ድጋፍ ያግኙ።':'Contact our team if you need more information.'}</p></div>}<HelpContact/></div></section>;
}
