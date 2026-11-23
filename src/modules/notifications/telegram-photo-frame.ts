import sharp,{type Sharp} from 'sharp';

/** The caller bounds the long edge. Pad unusually narrow photos to Telegram's
 * 20:1 limit without cropping the uploaded image. */
export async function telegramPhotoFrame(image:Sharp){
 const encoded=await image.toBuffer({resolveWithObject:true});
 const {width,height}=encoded.info;
 const horizontal=Math.max(0,Math.ceil(height/20)-width),vertical=Math.max(0,Math.ceil(width/20)-height);
 if(!horizontal&&!vertical)return encoded;
 const left=Math.floor(horizontal/2),top=Math.floor(vertical/2);
 return sharp(encoded.data).extend({left,right:horizontal-left,top,bottom:vertical-top,background:'#ffffff'}).toBuffer({resolveWithObject:true});
}
