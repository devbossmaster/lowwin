import {z} from 'zod';
import {cache} from 'react';
import {db} from '@/lib/db';
import {experienceSchema,legalSchema} from './content-schema';
const home=z.object({headline:z.string().max(90),lead:z.string().max(350),headlineAm:z.string().max(90).optional(),leadAm:z.string().max(350).optional()});
const faq=z.object({items:z.array(z.object({question:z.string().max(160),answer:z.string().max(1500),questionAm:z.string().max(160).optional(),answerAm:z.string().max(1500).optional()})).max(30)});
const content=cache(async(id:'home'|'faq'|'experience'|'terms'|'privacy')=>{
 try{return await db.siteContent.findUnique({where:{id:id==='faq'?'faq':'home'},select:{body:true}})}catch(error){
  // Public browsing must remain compatible with a database that has not received
  // Phase 5A yet. Do not migrate it implicitly, and do not hide unrelated failures.
  const failure=error as {code?:string;meta?:{modelName?:string;table?:string}};
  if(failure.code==='P2021'&&(failure.meta?.modelName==='SiteContent'||failure.meta?.table==='public.SiteContent'))return null;
  throw error;
 }
});
const brandCopy=(value:string)=>value.replace(/\bLowin\b/g,'Lowwin');
export async function publicHomeContent(){const row=await content('home');const parsed=home.safeParse(row?.body);return parsed.success?{...parsed.data,headline:brandCopy(parsed.data.headline),lead:brandCopy(parsed.data.lead)}:null}
export async function publicFaqContent(){const row=await content('faq');const parsed=faq.safeParse(row?.body);return parsed.success?parsed.data.items.map(item=>({...item,question:brandCopy(item.question),answer:brandCopy(item.answer)})):[]}
export async function publicHomeExperience(){const row=await content('home'),parsed=experienceSchema.safeParse((row?.body as {managedExperience?:unknown}|null)?.managedExperience);return parsed.success?parsed.data:null}
export async function publicLegalContent(kind:'terms'|'privacy'){const row=await content('home'),body=row?.body as {managedTerms?:unknown;managedPrivacy?:unknown}|null,parsed=legalSchema.safeParse(kind==='terms'?body?.managedTerms:body?.managedPrivacy);return parsed.success?parsed.data:null}
