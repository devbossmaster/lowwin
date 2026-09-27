'use client';
import { useState } from 'react';
export function CatalogImage({src,alt,className}:{src?:string;alt:string;className?:string}) {
  const [failed,setFailed]=useState(false);
  return <img className={className} src={failed||!src?'/catalog/fallback.svg':src} alt={alt} onError={()=>setFailed(true)} loading="lazy"/>;
}
