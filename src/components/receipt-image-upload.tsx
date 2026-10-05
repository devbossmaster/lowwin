'use client';
import {useRef} from 'react';
import {Image as ImageIcon,Upload,X} from 'lucide-react';
import {useWalletCopy} from './wallet-copy';
import styles from './wallet-page.module.css';

export type SelectedReceipt={file:File;url:string;name:string;size:number};
const fileSize=(bytes:number)=>bytes<1048576?`${Math.max(1,Math.round(bytes/1024))} KB`:`${(bytes/1048576).toFixed(1)} MB`;

export function ReceiptImageUpload({receipt=null,disabled=false,onSelect,onRemove}:{receipt?:SelectedReceipt|null;disabled?:boolean;onSelect?:(file?:File)=>void;onRemove?:()=>void}){
 const w=useWalletCopy(),input=useRef<HTMLInputElement>(null);
 return <>
  <h3 className={styles.receiptHeading}>{w('Payment receipt')}</h3>
  <div className={`${styles.upload} ${receipt?styles.uploadSelected:''}`} aria-disabled={disabled} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect=disabled?'none':'copy'}} onDrop={event=>{event.preventDefault();if(!disabled)onSelect?.(event.dataTransfer.files[0])}}>
   {receipt?<span className={styles.receiptPreview}><img src={receipt.url} alt={w('Selected receipt preview')}/></span>:<span className={styles.uploadIcon}><ImageIcon size={25}/></span>}
   <button type="button" className={styles.uploadButton} disabled={disabled} onClick={()=>input.current?.click()}><Upload size={17}/>{w(receipt?'Change image':'Choose image')}</button>
   <span className={styles.dropHint}>{w('or drag and drop here')}</span>
   <input ref={input} className="sr-only" tabIndex={-1} aria-label={w(receipt?'Change image':'Upload receipt image')} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event=>{onSelect?.(event.target.files?.[0]);event.target.value=''}}/>
  </div>
  {receipt&&<div className={styles.receiptFile}><span>{receipt.name} · {fileSize(receipt.size)}</span><button type="button" aria-label={w('Remove selected image')} disabled={disabled} onClick={onRemove}><X size={18}/></button></div>}
  <p className={styles.uploadHelp}>{w('Upload the full, clear payment screenshot. No cropping needed.')}<span>{w('JPEG, PNG or WebP · up to 5 MB')}</span></p>
 </>;
}
