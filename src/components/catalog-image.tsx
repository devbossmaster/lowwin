'use client';
import {createContext,useContext,useState} from 'react';
import Image from 'next/image';
import {useMiniLocale} from './mini-locale';
import {managedMediaPath,mediaRenditionPath,type MediaRendition} from '@/lib/media-renditions';
const PreviewImage=createContext<{src:string;alt:string}|null>(null);
/** Read-only image preview; enabled by the server's pinned staging capability. */
export function CatalogImagePreview({enabled,children}:{enabled:boolean;children:React.ReactNode}){
  const {language}=useMiniLocale();
  return <PreviewImage.Provider value={enabled?{src:'/images/lowwin-demo-headphones.webp',alt:language==='am'?'ሙከራ · የማዳመጫ ምስል':'DEMO · Headphones image preview'}:null}>{children}</PreviewImage.Provider>;
}
export function CatalogImage({src,alt,className,priority=false,variant='image',sizes='(max-width:480px) 100vw, 480px'}:{src?:string;alt:string;className?:string;priority?:boolean;variant?:'image'|'thumbnail';sizes?:string}) {
  const preview=useContext(PreviewImage),usePreview=!!preview&&!!src?.startsWith('/catalog/'),source=usePreview?preview!.src:src;
  const [failedSource,setFailedSource]=useState<string|null>(null);
  const resolved=!source||failedSource===source?'/catalog/fallback.svg':source,label=usePreview&&alt?preview!.alt:alt;
  const props={className,alt:label,onError:()=>setFailedSource(source??null),loading:priority?'eager' as const:'lazy' as const,fetchPriority:priority?'high' as const:'auto' as const};
  if(managedMediaPath(resolved)){
   const thumbnail=variant==='thumbnail',widths=thumbnail?[96,192]:[96,192,460,920,1840],kind=thumbnail?'thumb':'image';
   const path=(width:number)=>mediaRenditionPath(resolved,`${kind}-${width}` as MediaRendition);
   // Native same-origin requests retain cookies. These are actual encoded pixel
   // widths, including the square canvas used by small list thumbnails.
   return <img {...props} src={path(thumbnail?96:920)} srcSet={widths.map(width=>`${path(width)} ${width}w`).join(', ')} sizes={sizes} width={thumbnail?192:1840} height={thumbnail?192:800} decoding="async"/>;
  }
  // Static public rasters use Next's optimizer; managed uploads above retain the
  // authorization and consent checks of their cookie-bound media route.
  return resolved.startsWith('/images/')&&/\.(webp|png|jpe?g)$/.test(resolved)?<Image {...props} src={resolved} width={1840} height={800} sizes={sizes} quality={75}/>:<img {...props} src={resolved} width={1840} height={800} decoding="async"/>;
}
