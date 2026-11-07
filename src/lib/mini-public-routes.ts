/** Public display surfaces only. Mutations and account data always authorize
 * in their handlers, including when the visitor has a signed Telegram launch. */
export function isPublicMiniPage(path:string){
 return ['/', '/telegram','/auctions','/auctions/all','/winners','/winners/all','/draws','/terms','/privacy','/faq','/how-it-works'].includes(path)
  || /^\/auctions\/[a-zA-Z0-9-]{1,120}$/.test(path)
  || /^\/categories\/[a-zA-Z0-9-]{1,120}$/.test(path)
  || /^\/winners\/[a-zA-Z0-9-]{1,120}$/.test(path);
}
export function isPublicMiniRead(path:string,method='GET'){
 if(method!=='GET'&&method!=='HEAD')return false;
 return ['/api/catalog/auctions','/api/catalog/categories','/api/catalog/activity','/api/results','/api/results/winners'].includes(path)
  || /^\/api\/catalog\/auctions\/[a-zA-Z0-9-]{1,120}$/.test(path)
  || /^\/api\/results\/[a-zA-Z0-9-]{1,120}$/.test(path)
  || /^\/api\/results\/[a-zA-Z0-9-]{1,120}\/breakdown$/.test(path);
}
/** These pages contain client gates only; their data still requires the bound
 * registered session in private API handlers. Rendering a login shell avoids a
 * /telegram -> account -> /telegram redirect loop for a browsing guest. */
export function isMiniAccountShell(path:string){return ['/profile','/profile/alerts','/profile/favorites','/profile/wins','/profile/support','/my-bids','/winning-bids','/wallet','/wallet/deposit','/payments'].includes(path)}
