import {TelegramProvider} from '@/components/telegram-provider';
import {TelegramEntry} from '@/components/telegram-entry';
export default function TelegramPage(){const name=process.env.TELEGRAM_BOT_USERNAME;const botUrl=name&&/^[A-Za-z0-9_]+bot$/i.test(name)?`https://t.me/${name}?start=lowin`:null;return <TelegramProvider devEnabled={false} botUrl={botUrl} requireLaunch><TelegramEntry/></TelegramProvider>}
