'use client';

export function AdminProductDescription({description,descriptionAm}:{description?:string;descriptionAm?:string|null}){
  return <fieldset className="admin-form-group"><legend>Product details</legend><p className="admin-group-note">One field per language. Use one specification per line, for example Display: 6.7-inch LCD. Plain paragraphs work too.</p><label>Description (English)<textarea name="description" lang="en" defaultValue={description??''} rows={8} maxLength={1500} placeholder={'Display: 6.7-inch LCD\nStorage: 128 GB\nBattery: 5000 mAh'} required/></label><label>Description (Amharic)<textarea name="descriptionAm" lang="am" defaultValue={descriptionAm??''} rows={8} maxLength={1500} placeholder={'ማሳያ: 6.7 ኢንች LCD\nማከማቻ: 128 GB\nባትሪ: 5000 mAh'} required/></label></fieldset>;
}
