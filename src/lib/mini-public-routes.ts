/** Guests may inspect products; account features and complete results require registration. */
export function isPublicMiniPage(path:string){
 return path==='/'||path==='/auctions'||path==='/auctions/all'||/^\/auctions\/[A-Za-z0-9-]{1,120}$/.test(path)||/^\/categories\/[a-z0-9-]{1,80}$/.test(path);
}
export function isPublicMiniRead(path:string,method='GET'){
 if(method!=='GET'&&method!=='HEAD')return false;
 return ['/api/catalog/auctions','/api/catalog/categories','/api/catalog/activity','/api/results/recent-winners'].includes(path)||/^\/api\/catalog\/auctions\/[A-Za-z0-9-]{1,120}$/.test(path);
}
/** Retained compatibility export: customer pages no longer bypass server auth. */
export function isMiniAccountShell(_path:string){return false}
