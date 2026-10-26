import {permissions,type StaffRole,type Permission} from './permissions';
export type AdminArea='Overview'|'Auctions and Catalog'|'Players and Wallets'|'Payments and Refunds'|'Winners and Deliveries'|'Content and Messages'|'Reports and Settings';
export type AdminAccess={role:StaffRole;permissions:readonly Permission[];cacheIdentity?:string;expiresAt?:string};
type Task={href:string;label:string;area:AdminArea;permission?:Permission;roles?:readonly StaffRole[]};
export const adminTasks:readonly Task[]=[
 {href:'/admin',label:'Overview',area:'Overview'},
 {href:'/admin/auctions',label:'Auctions',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/products',label:'Products',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/categories',label:'Categories',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/media',label:'Media library',area:'Auctions and Catalog',permission:'catalog'},
 {href:'/admin/users',label:'Players',area:'Players and Wallets',permission:'support'},
 {href:'/admin/wallets',label:'Wallets & journals',area:'Players and Wallets',permission:'wallets'},
 {href:'/admin/referrals',label:'Referral rewards',area:'Players and Wallets',permission:'wallets'},
 {href:'/admin/payments',label:'Transactions',area:'Payments and Refunds',roles:['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT']},
 {href:'/admin/refunds',label:'Refunds & compensation',area:'Payments and Refunds',permission:'wallets'},
 {href:'/admin/reconciliation',label:'Reconciliation',area:'Payments and Refunds',permission:'audit'},
 {href:'/admin/results',label:'Finalized results',area:'Winners and Deliveries',permission:'audit'},
 {href:'/admin/fulfillment',label:'Deliveries',area:'Winners and Deliveries',permission:'fulfillment'},
 {href:'/admin/content',label:'Customer content',area:'Content and Messages',permission:'catalog'},
 {href:'/admin/notifications',label:'Broadcasts',area:'Content and Messages',permission:'jobs'},
 {href:'/admin/jobs',label:'Delivery history',area:'Content and Messages',permission:'jobs'},
 {href:'/admin/analytics',label:'Financial reports',area:'Reports and Settings',permission:'audit'},
 {href:'/admin/settings',label:'System & gateways',area:'Reports and Settings',permission:'settings'},
 {href:'/admin/settings/referrals',label:'Referral policy',area:'Reports and Settings',permission:'settings'},
 {href:'/admin/audit',label:'Audit trail',area:'Reports and Settings',permission:'audit'},
 {href:'/admin/team',label:'Staff access',area:'Reports and Settings',permission:'team'},
];
export const adminAreas:readonly AdminArea[]=['Overview','Auctions and Catalog','Players and Wallets','Payments and Refunds','Winners and Deliveries','Content and Messages','Reports and Settings'];
export const roleLabels:Record<StaffRole,string>={OWNER:'Owner',CATALOG_MANAGER:'Catalog manager',SUPPORT:'Player care',FULFILLMENT:'Fulfillment',PAYMENTS_OPERATOR:'Payments operator',AUDITOR:'Auditor'};
export function allowedTasks(role:StaffRole){return adminTasks.filter(t=>t.roles?t.roles.includes(role):!t.permission||permissions(role).includes(t.permission));}
export function activeTask(path:string){if(/\/admin\/auctions\/[^/]+\/proof$/.test(path))return adminTasks.find(t=>t.href==='/admin/results')!;if(path.startsWith('/admin/top-ups'))return adminTasks.find(t=>t.href==='/admin/payments')!;return [...adminTasks].sort((a,b)=>b.href.length-a.href.length).find(t=>path===t.href||t.href!=='/admin'&&path.startsWith(t.href+'/'))??adminTasks[0];}
export function areaLanding(role:StaffRole,area:AdminArea){return allowedTasks(role).find(t=>t.area===area)?.href;}
