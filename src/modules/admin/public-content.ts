import {z} from 'zod';
import {db} from '@/lib/db';
const home=z.object({headline:z.string().max(90),lead:z.string().max(350)});
const faq=z.object({items:z.array(z.object({question:z.string().max(160),answer:z.string().max(1500)})).max(30)});
async function content(id:'home'|'faq'){
 try{return await db.siteContent.findUnique({where:{id},select:{body:true}})}catch(error){
  // Public browsing must remain compatible with a database that has not received
  // Phase 5A yet. Do not migrate it implicitly, and do not hide unrelated failures.
  const failure=error as {code?:string;meta?:{modelName?:string;table?:string}};
  if(failure.code==='P2021'&&(failure.meta?.modelName==='SiteContent'||failure.meta?.table==='public.SiteContent'))return null;
  throw error;
 }
}
export async function publicHomeContent(){const row=await content('home');const parsed=home.safeParse(row?.body);return parsed.success?parsed.data:null}
export async function publicFaqContent(){const row=await content('faq');const parsed=faq.safeParse(row?.body);return parsed.success?parsed.data.items:[]}
