'use client';
import {createContext,useContext,useState} from 'react';
import {useMiniLocale} from './mini-locale';
const PreviewImage=createContext<{src:string;alt:string}|null>(null);
/** Read-only image preview; enabled by the server's pinned staging capability. */
export function CatalogImagePreview({enabled,children}:{enabled:boolean;children:React.ReactNode}){
  const {language}=useMiniLocale();
  return <PreviewImage.Provider value={enabled?{src:'/images/lowwin-demo-headphones.webp',alt:language==='am'?'ሙከራ · የማዳመጫ ምስል':'DEMO · Headphones image preview'}:null}>{children}</PreviewImage.Provider>;
}
export function CatalogImage({src,alt,className}:{src?:string;alt:string;className?:string}) {
  const preview=useContext(PreviewImage),usePreview=!!preview&&!!src?.startsWith('/catalog/'),source=usePreview?preview!.src:src;
  const [failedSource,setFailedSource]=useState<string|null>(null);
  return <img className={className} src={!source||failedSource===source?'/catalog/fallback.svg':source} alt={usePreview&&alt?preview!.alt:alt} onError={()=>setFailedSource(source??null)} loading="lazy"/>;
}
