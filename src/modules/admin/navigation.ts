import {permissions,type StaffRole,type Permission} from './permissions';
export type AdminArea='Overview'|'Auctions'|'Money'|'People'|'Settings';
export type AdminAccess={role:StaffRole;permissions:readonly Permission[]};
type Task={href:string;label:string;area:AdminArea;permission?:Permission;roles?:readonly StaffRole[]};
export const adminTasks:readonly Task[]=[
 {href:'/admin',label:'Overview',area:'Overview'},
 {href:'/admin/auctions',label:'Auctions',area:'Auctions',permission:'catalog'},
 {href:'/admin/products',label:'Products & images',area:'Auctions',permission:'catalog'},
 {href:'/admin/categories',label:'Categories',area:'Auctions',permission:'catalog'},
 {href:'/admin/results',label:'Results',area:'Auctions',permission:'audit'},
 {href:'/admin/top-ups',label:'Deposits',area:'Money',roles:['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT']},
 {href:'/admin/settings/payments',label:'Receiving accounts',area:'Money',roles:['OWNER']},
 {href:'/admin/users',label:'Players',area:'People',permission:'support'},
 {href:'/admin/fulfillment',label:'Deliveries',area:'People',permission:'fulfillment'},
 {href:'/admin/notifications',label:'Messages',area:'People',permission:'jobs'},
 {href:'/admin/analytics',label:'Business summary',area:'Overview',permission:'audit'},
 {href:'/admin/audit',label:'Staff activity',area:'Settings',permission:'audit'},
 {href:'/admin/jobs',label:'Message delivery',area:'Settings',permission:'jobs'},
 {href:'/admin/settings',label:'Workspace information',area:'Settings',permission:'settings'},
 {href:'/admin/team',label:'Team access',area:'Settings',permission:'team'},
];
export const adminAreas:readonly AdminArea[]=['Overview','Auctions','Money','People','Settings'];
export const roleLabels:Record<StaffRole,string>={OWNER:'Owner',CATALOG_MANAGER:'Catalog manager',SUPPORT:'Player care',FULFILLMENT:'Fulfillment',PAYMENTS_OPERATOR:'Payments operator',AUDITOR:'Auditor'};
export function allowedTasks(role:StaffRole){return adminTasks.filter(t=>t.roles?t.roles.includes(role):!t.permission||permissions(role).includes(t.permission));}
export function activeTask(path:string){if(/\/admin\/auctions\/[^/]+\/proof$/.test(path))return adminTasks.find(t=>t.href==='/admin/results')!;return [...adminTasks].sort((a,b)=>b.href.length-a.href.length).find(t=>path===t.href||t.href!=='/admin'&&path.startsWith(t.href+'/'))??adminTasks[0];}
export function areaLanding(role:StaffRole,area:AdminArea){return allowedTasks(role).find(t=>t.area===area)?.href;}
