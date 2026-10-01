import {z} from 'zod';
import {AdminError} from './errors';

export const categoryTranslationSchema=z.object({name:z.string().trim().min(1).max(80),description:z.string().trim().min(1).max(600)}).strict();

const translationResponseSchema=z.object({data:z.object({translations:z.array(z.object({translatedText:z.string().min(1)})).length(2)})});

function decodeEntities(value:string){
  return value.replace(/&#(\d+);|&#x([\da-f]+);|&(amp|lt|gt|quot|#39);/gi,(_match,decimal,hex,named)=>{
    if(decimal)return String.fromCodePoint(Number(decimal));
    if(hex)return String.fromCodePoint(Number.parseInt(hex,16));
    return ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"} as Record<string,string>)[String(named).toLowerCase()]??_match;
  });
}

export async function translateCategoryCopy(raw:unknown,env:NodeJS.ProcessEnv=process.env){
  const input=categoryTranslationSchema.parse(raw),key=env.GOOGLE_TRANSLATE_API_KEY?.trim();
  if(!key)throw new AdminError(503,'Automatic translation is not configured. Add the Amharic text manually or configure Google Cloud Translation.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const url=new URL('https://translation.googleapis.com/language/translate/v2');url.searchParams.set('key',key);
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:[input.name,input.description],source:'en',target:'am',format:'text'}),signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw new AdminError(503,'Automatic translation is temporarily unavailable. Enter the Amharic text manually.');
    const parsed=translationResponseSchema.safeParse(await response.json());
    if(!parsed.success)throw new AdminError(503,'The translation provider returned an incomplete result. Enter the Amharic text manually.');
    return {nameAm:decodeEntities(parsed.data.data.translations[0].translatedText).trim(),descriptionAm:decodeEntities(parsed.data.data.translations[1].translatedText).trim()};
  }catch(error){
    if(error instanceof AdminError)throw error;
    throw new AdminError(503,'Automatic translation is temporarily unavailable. Enter the Amharic text manually.');
  }finally{clearTimeout(timer)}
}
