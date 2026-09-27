import {AdminError} from './errors';
export const staffRoles=['OWNER','CATALOG_MANAGER','SUPPORT','FULFILLMENT','PAYMENTS_OPERATOR','AUDITOR'] as const;
export type StaffRole=typeof staffRoles[number];
export type Permission='catalog'|'support'|'fulfillment'|'audit'|'team'|'cancel'|'jobs'|'settings'|'wallets';
const grants:Record<StaffRole,readonly Permission[]>={OWNER:['catalog','support','fulfillment','audit','team','cancel','jobs','settings','wallets'],CATALOG_MANAGER:['catalog'],SUPPORT:['support'],FULFILLMENT:['fulfillment'],PAYMENTS_OPERATOR:['wallets'],AUDITOR:['audit','wallets']};
export function permissions(role:string):readonly Permission[]{return grants[role as StaffRole]??[]}
export function assertPermission(role:string,permission:Permission){if(!permissions(role).includes(permission))throw new AdminError(403,'Your staff role does not grant this permission.')}
