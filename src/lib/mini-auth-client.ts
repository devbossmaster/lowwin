// Covers the server's bounded 10s pool wait + 30s sign-in transaction.
export const MINI_AUTH_TIMEOUT_MS = 45000;
export type MiniAccount = {
  sessionKey?:string;
  user:{id:string;name:string;image?:string|null};
  wallet:{available:string;held:string;demo?:boolean};
};
type Bootstrap = {status:'authenticated';me:MiniAccount}|{status:'contact-required';me:null};

export class TelegramLaunchError extends Error {
  constructor() {
    super('Your Telegram launch could not be verified. Open the bot, then tap Open Lowwin to start again.');
    this.name = 'TelegramLaunchError';
  }
}

export async function signInTelegram(initData:string):Promise<Bootstrap> {
  const response=await fetch('/api/auth/telegram/miniapp/signin',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({initData}),
    signal:AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS),
  });
  if(!response.ok) {
    if(response.status===429)throw new Error('Too many attempts. Try again shortly.');
    if(response.status===401||response.status===403)throw new TelegramLaunchError();
    throw new Error('Connection interrupted. Tap Retry.');
  }
  const result=await response.json() as Bootstrap;
  if(result.status==='contact-required'||result.status==='authenticated'&&result.me)return result;
  throw new Error('Account could not load. Tap Retry.');
}

export function miniAuthError(error:unknown) {
  if(error instanceof Error) {
    if(error.name==='TimeoutError'||error.name==='AbortError')return 'Connection took too long. Tap Retry.';
    if(error instanceof TypeError)return 'Connection interrupted. Tap Retry.';
    return error.message;
  }
  return 'Connection interrupted. Tap Retry.';
}
