import {demoBidAllowed} from '@/modules/auctions/bids';
import {privateHeaders,requireUser,privateError} from '@/modules/auth/private-api';
export async function GET(r:Request){try{await requireUser(r);const enabled=process.env.WALLET_TEST_PREVIEW==='true'&&demoBidAllowed();return Response.json({enabled,accounts:enabled?[{id:'telebirr',name:'Telebirr',number:'TEST-TELEBIRR-NOT-PAYABLE',holder:'Lowin DEMO account'},{id:'cbe',name:'CBE',number:'TEST-CBE-NOT-PAYABLE',holder:'Lowin DEMO account'}]:[]},{headers:privateHeaders})}catch(e){return privateError(e)}}
