// ManagedMedia ids and bytes are immutable. Bump the version when encoding changes;
// the original path stays the published reference and full-resolution download.
export const MEDIA_RENDITION_VERSION='1';
export const mediaRenditions={
 'image-96':{width:96,square:false},
 'image-192':{width:192,square:false},
 'image-460':{width:460,square:false},
 'image-920':{width:920,square:false},
 'image-1840':{width:1840,square:false},
 'thumb-96':{width:96,square:true},
 'thumb-192':{width:192,square:true},
} as const;
export type MediaRendition=keyof typeof mediaRenditions;
export function isMediaRendition(value:string):value is MediaRendition{return Object.hasOwn(mediaRenditions,value)}
export function managedMediaPath(source:string){return /^\/api\/media\/[0-9a-f-]{36}$/i.test(source)}
export function mediaRenditionPath(source:string,rendition:MediaRendition){return `${source}?v=${MEDIA_RENDITION_VERSION}&rendition=${rendition}`}
