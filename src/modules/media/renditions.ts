import sharp from 'sharp';
import {mediaRenditions,type MediaRendition} from '@/lib/media-renditions';

export async function createMediaRendition(bytes:Uint8Array,rendition:MediaRendition){
 const {width,square}=mediaRenditions[rendition];
 // Preserve the entire composition. Transparent padding keeps square list photos
 // from cropping banners, packaging, or a person's face. Originals stay untouched.
 const image=sharp(bytes,{limitInputPixels:16000000,animated:false}).rotate();
 return image.resize(square?{width,height:width,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}:{width})
  .webp({quality:square?82:86,effort:4}).toBuffer();
}
