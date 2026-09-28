import 'dotenv/config';
import { getEnv } from '../src/lib/env';
import { createBot } from '../src/modules/bot/bot';
const env = getEnv();
if (!env.MINI_APP_URL.startsWith('https://')) throw new Error('Telegram requires a public HTTPS Mini App URL.');
const bot = createBot();
try {
  await bot.api.setMyCommands([{ command: 'start', description: 'Launch Lowwin' }, { command: 'help', description: 'Understand Lowwin' }]);
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Launch Lowwin', web_app: { url: env.MINI_APP_URL } } });
  await bot.api.setWebhook(`${new URL(env.MINI_APP_URL).origin}/api/bot/webhook`, { secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: false });
  console.log('Bot commands, menu and webhook configured.');
} catch { console.error('Bot setup failed. Check server-side credentials and HTTPS URL. No secrets were logged.'); process.exitCode = 1; }
