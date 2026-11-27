'use client';
import {createContext,useContext,useState} from 'react';
import {preload} from 'react-dom';
import Image,{getImageProps} from 'next/image';
import {useMiniLocale} from './mini-locale';
import {homeAuctionImageSizes,managedMediaPath,mediaRenditionPath,type MediaRendition} from '@/lib/media-renditions';
const PreviewImage=createContext<{src:string;alt:string}|null>(null);
const catalogSizes='(max-width:480px) 100vw, 480px';
const staticImage=(src:string)=>src.startsWith('/images/')&&/\.(webp|png|jpe?g)$/.test(src);

function managedImageProps(src:string,thumbnail:boolean,winner:boolean){
 const widths=thumbnail?[96,192]:[96,192,460,736,920,1288,1840],kind=thumbnail?'thumb':'image';
 const path=(width:number)=>mediaRenditionPath(src,`${kind}-${width}` as MediaRendition,winner);
 return {src:path(thumbnail?96:920),srcSet:widths.map(width=>`${path(width)} ${width}w`).join(', '),width:thumbnail?192:1840,height:thumbnail?192:800};
}

/** Warm the first Home product while its streamed data reaches the client. */
export function HomeAuctionImagePreload({src}:{src?:string}){
 if(!src)return null;
 const image=managedMediaPath(src)?managedImageProps(src,false,false):staticImage(src)?getImageProps({src,alt:'',width:1840,height:800,sizes:homeAuctionImageSizes,quality:75}).props:null;
 if(image)preload(image.src,{as:'image',imageSrcSet:image.srcSet,imageSizes:homeAuctionImageSizes});
 return null;
}
/** Read-only image preview; enabled by the server's pinned staging capability. */
export function CatalogImagePreview({enabled,children}:{enabled:boolean;children:React.ReactNode}){
  const {language}=useMiniLocale();
  return <PreviewImage.Provider value={enabled?{src:'/images/lowwin-demo-headphones.webp',alt:language==='am'?'ሙከራ · የማዳመጫ ምስል':'DEMO · Headphones image preview'}:null}>{children}</PreviewImage.Provider>;
}
export function CatalogImage({src,alt,className,priority=false,eager=false,winner=false,variant='image',sizes=catalogSizes}:{src?:string;alt:string;className?:string;priority?:boolean;eager?:boolean;winner?:boolean;variant?:'image'|'thumbnail';sizes?:string}) {
  const preview=useContext(PreviewImage),usePreview=!!preview&&!!src?.startsWith('/catalog/'),source=usePreview?preview!.src:src;
  const [failedSource,setFailedSource]=useState<string|null>(null);
  const resolved=!source||failedSource===source?'/catalog/fallback.svg':source,label=usePreview&&alt?preview!.alt:alt;
  const props={className,alt:label,onError:()=>setFailedSource(source??null),loading:priority||eager?'eager' as const:'lazy' as const,fetchPriority:priority?'high' as const:'auto' as const};
  if(managedMediaPath(resolved)){
   // Native same-origin requests retain cookies. These are actual encoded pixel
   // widths, including the square canvas used by small list thumbnails.
   return <img {...props} {...managedImageProps(resolved,variant==='thumbnail',winner)} sizes={sizes} decoding="async"/>;
  }
  // Static public rasters use Next's optimizer; managed uploads above retain the
  // authorization and consent checks of their cookie-bound media route.
  return staticImage(resolved)?<Image {...props} src={resolved} width={1840} height={800} sizes={sizes} quality={75}/>:<img {...props} src={resolved} width={1840} height={800} decoding="async"/>;
}
