import {z} from 'zod';
import {resolveLearnMoreMedia} from '@/lib/learn-more-media';
const text=(max:number)=>z.string().trim().min(1).max(max),optional=(max:number)=>z.string().trim().max(max).default('');
const bilingual=z.object({en:text(10000),am:text(10000)}).strict();
const image=z.string().regex(/^\/(?:images\/[A-Za-z0-9/_-]+\.(?:webp|png|jpe?g)|api\/media\/[a-f0-9-]{36})$/).or(z.literal('')).default('');
const video=z.object({youtube:optional(500),local:optional(250),poster:image}).strict().refine(v=>!v.youtube&&!v.local||!!resolveLearnMoreMedia(v),'Use a valid HTTPS YouTube link or a local /videos/…mp4 or webm path.');
export const experienceSchema=z.object({bannerEn:image,bannerAm:image,learnIntroEn:optional(1000),learnIntroAm:optional(1000),video,socials:z.array(z.object({platform:z.enum(['telegram','facebook','instagram','tiktok','youtube']),url:z.url().max(500).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&['t.me','www.facebook.com','facebook.com','instagram.com','www.instagram.com','tiktok.com','www.tiktok.com','youtube.com','www.youtube.com'].includes(u.hostname)},'Use the official HTTPS social domain.')})).max(5)}).strict();
export const legalSchema=z.object({title:bilingual,intro:bilingual.optional(),closing:bilingual.optional(),effectiveDate:z.iso.date().optional(),updatedDate:z.iso.date().optional(),sections:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9-]{0,60}$/),title:bilingual,paragraphs:z.array(bilingual).min(1).max(20)}).strict()).max(40)}).strict().refine(v=>new Set(v.sections.map(s=>s.id)).size===v.sections.length,'Section IDs must be unique.');
export type HomeExperience=z.infer<typeof experienceSchema>;
