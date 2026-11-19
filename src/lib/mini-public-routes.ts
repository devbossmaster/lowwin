/** Home is the only public customer page. Its data feeds return preview DTOs. */
export function isPublicMiniPage(path:string){
 return path==='/';
}
export function isPublicMiniRead(path:string,method='GET'){
 if(method!=='GET'&&method!=='HEAD')return false;
 return ['/api/catalog/auctions','/api/catalog/categories','/api/catalog/activity','/api/results/recent-winners'].includes(path);
}
/** Retained compatibility export: customer pages no longer bypass server auth. */
export function isMiniAccountShell(_path:string){return false}
