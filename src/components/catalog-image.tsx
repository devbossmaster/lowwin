'use client';
import {createContext,useContext,useState} from 'react';
import Image from 'next/image';
import {useMiniLocale} from './mini-locale';
const PreviewImage=createContext<{src:string;alt:string}|null>(null);
/** Read-only image preview; enabled by the server's pinned staging capability. */
export function CatalogImagePreview({enabled,children}:{enabled:boolean;children:React.ReactNode}){
  const {language}=useMiniLocale();
  return <PreviewImage.Provider value={enabled?{src:'/images/lowwin-demo-headphones.webp',alt:language==='am'?'ሙከራ · የማዳመጫ ምስል':'DEMO · Headphones image preview'}:null}>{children}</PreviewImage.Provider>;
}
export function CatalogImage({src,alt,className,priority=false,sizes='(max-width:480px) 100vw, 480px'}:{src?:string;alt:string;className?:string;priority?:boolean;sizes?:string}) {
  const preview=useContext(PreviewImage),usePreview=!!preview&&!!src?.startsWith('/catalog/'),source=usePreview?preview!.src:src;
  const [failedSource,setFailedSource]=useState<string|null>(null);
  const resolved=!source||failedSource===source?'/catalog/fallback.svg':source,label=usePreview&&alt?preview!.alt:alt;
  const props={className,alt:label,onError:()=>setFailedSource(source??null),loading:priority?'eager' as const:'lazy' as const,fetchPriority:priority?'high' as const:'auto' as const};
  // Only this known public raster is optimized. Authenticated uploads keep their cookie-bound URL.
  return resolved==='/images/lowwin-demo-headphones.webp'?<Image {...props} src={resolved} width={1840} height={800} sizes={sizes} quality={75}/>:<img {...props} src={resolved} decoding="async"/>;
}
