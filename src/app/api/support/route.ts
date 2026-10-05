import {TELEGRAM_SUPPORT_URL} from '@/lib/telegram-community';
export const dynamic='force-dynamic';
function retired(_request:Request){return Response.json({error:'Contact Lowwin support on Telegram.',supportUrl:TELEGRAM_SUPPORT_URL},{status:410,headers:{'Cache-Control':'no-store'}})}
export const GET=retired;
export const POST=retired;
