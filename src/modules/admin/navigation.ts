import {permissions,type StaffRole,type Permission} from './permissions';
export type AdminArea='Overview'|'Auctions and Catalog'|'Players'|'Payments'|'Winners'|'Broadcast';
export type AdminAccess={role:StaffRole;permissions:readonly Permission[];cacheIdentity?:string;expiresAt?:string};
type Task={href:string;label:string;area:AdminArea;permission?:Permission;roles?:readonly StaffRole[]};
export const adminTasks:readonly Task[]=[
 {href:'/admin',label:'Overview',area:'Overview'},
 {href:'/admin/auctions',label:'Auctions',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/products',label:'Products',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/categories',label:'Categories',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/media',label:'Media library',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/users',label:'Players',area:'Players',roles:['OWNER','SUPPORT','PAYMENTS_OPERATOR','AUDITOR']},
 {href:'/admin/payments',label:'Payments',area:'Payments',roles:['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT']},
 {href:'/admin/fulfillment',label:'Winners',area:'Winners',roles:['OWNER','FULFILLMENT','AUDITOR']},
 {href:'/admin/notifications',label:'Broadcast',area:'Broadcast',permission:'jobs'},
];
export const adminAreas:readonly AdminArea[]=['Overview','Auctions and Catalog','Players','Payments','Winners','Broadcast'];
export const roleLabels:Record<StaffRole,string>={OWNER:'Admin',CATALOG_MANAGER:'Catalog manager',SUPPORT:'Player care',FULFILLMENT:'Fulfillment',PAYMENTS_OPERATOR:'Payments operator',AUDITOR:'Auditor'};
export function allowedTasks(role:StaffRole){return adminTasks.filter(t=>t.roles?t.roles.includes(role):!t.permission||permissions(role).includes(t.permission));}
export function activeTask(path:string){if(/\/admin\/auctions\/[^/]+\/proof$/.test(path))return adminTasks.find(t=>t.href==='/admin/fulfillment')!;if(path.startsWith('/admin/top-ups'))return adminTasks.find(t=>t.href==='/admin/payments')!;return [...adminTasks].sort((a,b)=>b.href.length-a.href.length).find(t=>path===t.href||t.href!=='/admin'&&path.startsWith(t.href+'/'))??adminTasks[0];}
export function areaLanding(role:StaffRole,area:AdminArea){return allowedTasks(role).find(t=>t.area===area)?.href;}
