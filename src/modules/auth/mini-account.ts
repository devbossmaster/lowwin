import type {Prisma, PrismaClient} from '@prisma/client';
import {ensureWallet} from '../wallet/ledger';
import {contactStatus} from './own-contact';

type Client = PrismaClient | Prisma.TransactionClient;
type Player = {id:string; name:string; image?:string|null};

// Shared by sign-in and account refresh. Never return cookies or session tokens.
export async function readMiniAccount(client:Client, user:Player) {
  let [accounts, profile] = await Promise.all([
    client.ledgerAccount.findMany({where:{wallet:{userId:user.id}},select:{kind:true,balance:true}}),
    client.playerProfile.findUnique({where:{userId:user.id},select:{displayName:true}}),
  ]);
  if (!accounts.some(a=>a.kind==='AVAILABLE') || !accounts.some(a=>a.kind==='HELD')) {
    const initialize = async (tx:Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${user.id}`}, 0))`;
      const wallet = await ensureWallet(tx, user.id);
      return tx.ledgerAccount.findMany({where:{walletId:wallet.id},select:{kind:true,balance:true}});
    };
    accounts = '$transaction' in client
      ? await client.$transaction(initialize, {maxWait:10000,timeout:20000})
      : await initialize(client);
  }
  return {
    user:{id:user.id,name:profile?.displayName??user.name,image:user.image??null},
    wallet:{
      available:accounts.find(a=>a.kind==='AVAILABLE')!.balance.toString(),
      held:accounts.find(a=>a.kind==='HELD')!.balance.toString(),
      demo:['staging','local','test'].includes(process.env.APP_ENV??''),
    },
  };
}

export async function telegramBootstrap(client:Client, user:Player, telegramId:string) {
  const contact = await contactStatus(client,user.id,telegramId);
  if (!contact.verified) return {ok:true as const,status:'contact-required' as const,me:null};
  return {ok:true as const,status:'authenticated' as const,me:await readMiniAccount(client,user)};
}
