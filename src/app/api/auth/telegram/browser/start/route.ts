import {startTelegramBrowserLogin} from '@/modules/auth/telegram-browser';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return startTelegramBrowserLogin(request)}
