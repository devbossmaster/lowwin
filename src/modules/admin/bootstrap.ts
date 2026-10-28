import type {PrismaClient} from '@prisma/client';
// Legacy imports remain explicit failures; no invitation, first-owner or MFA
// provisioning path can be executed from an old operator script.
export async function bootstrapOwner(_client:PrismaClient,_email:string):Promise<never>{throw new Error('Bootstrap is retired. Register and verify an email, then assign its admin role in the database.')}
export async function reissueInitialOwner(_client:PrismaClient,_reason:string,_email?:string):Promise<never>{throw new Error('Bootstrap is retired. Use the email verification or password reset form.')}
