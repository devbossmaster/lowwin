import {redirect} from 'next/navigation';
import {TELEGRAM_SUPPORT_URL} from '@/lib/telegram-community';
export default function Support(){redirect(TELEGRAM_SUPPORT_URL)}
